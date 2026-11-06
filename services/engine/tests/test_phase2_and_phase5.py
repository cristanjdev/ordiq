"""Comprehensive Phase 2 (Validator, CP-SAT Solver, Diagnostics) and Phase 5 (ML) tests."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import settings as hyp_settings
from hypothesis import strategies as st

from engine.config import get_settings
from engine.domain.models import (
    AlternativesRequest,
    AvailabilityWindow,
    CalendarRestrictionModel,
    ComponentType,
    ConstraintHardness,
    DirectiveModel,
    DirectiveType,
    ExceptionWaiverModel,
    FacultyModel,
    FacultyPreferenceModel,
    FacultySubjectPair,
    FixedBlockModel,
    HardConstraintCode,
    HistoricalAssignmentSample,
    MLRecommendRequest,
    MLTrainRequest,
    OfferingModel,
    Problem,
    QualificationModel,
    RoomModel,
    RoomType,
    ScheduledMeetingEntry,
    SectionModel,
    SubjectModel,
    TermConfig,
    UnscheduledReasonCode,
    Weekday,
)
from engine.main import app
from engine.ml.recommender import recommend_faculty, train_fit_model
from engine.solver.cpsat_solver import find_alternative_slots, solve_problem
from engine.validator.validator import validate_schedule

settings = get_settings()
HEADERS = {"X-Engine-Token": settings.engine_token}


def _base_problem() -> Problem:
    """Create a clean, feasible base Problem snapshot."""
    return Problem(
        term=TermConfig(
            code="AY2026-2027-S1",
            slot_step_minutes=30,
            day_start_min=450,
            day_end_min=1230,
            allowed_weekdays=[
                Weekday.MONDAY,
                Weekday.TUESDAY,
                Weekday.WEDNESDAY,
                Weekday.THURSDAY,
                Weekday.FRIDAY,
            ],
            official_breaks=[(720, 780)],  # 12:00 - 13:00 lunch break
        ),
        faculty=[
            FacultyModel(
                code="FAC-1",
                name="Faculty One",
                program_code="CE",
                specialization="Structural Analysis Concrete Design",
                max_load_units=21.0,
                max_load_hours=24.0,
            ),
            FacultyModel(
                code="FAC-2",
                name="Faculty Two",
                program_code="CPE",
                specialization="Embedded Systems Microprocessors Digital Logic",
                max_load_units=21.0,
                max_load_hours=24.0,
            ),
        ],
        subjects=[
            SubjectModel(
                code="CE101",
                name="Structural Analysis",
                program_code="CE",
                year_level=1,
                category="MAJOR",
                units=3.0,
                contact_hours=3.0,
            ),
            SubjectModel(
                code="CPE201L",
                name="Embedded Systems Lab",
                program_code="CPE",
                year_level=2,
                category="MAJOR",
                units=3.0,
                contact_hours=3.0,
            ),
        ],
        sections=[
            SectionModel(code="BSCE-1A", program_code="CE", year_level=1, student_count=35),
            SectionModel(code="BSCPE-2A", program_code="CPE", year_level=2, student_count=30),
        ],
        rooms=[
            RoomModel(code="LEC-1", type=RoomType.LECTURE, capacity=45),
            RoomModel(code="LAB-1", type=RoomType.LAB, capacity=35),
        ],
        offerings=[
            OfferingModel(
                code="OFF-CE101",
                section_code="BSCE-1A",
                subject_code="CE101",
                component=ComponentType.LECTURE,
                meetings_per_week=2,
                minutes_per_meeting=90,
                meeting_pattern="MWF",
                required_room_type=RoomType.LECTURE,
            ),
            OfferingModel(
                code="OFF-CPE201L",
                section_code="BSCPE-2A",
                subject_code="CPE201L",
                component=ComponentType.LAB,
                meetings_per_week=2,
                minutes_per_meeting=90,
                meeting_pattern="TTH",
                required_room_type=RoomType.LAB,
            ),
        ],
        qualifications=[
            QualificationModel(faculty_code="FAC-1", subject_code="CE101"),
            QualificationModel(faculty_code="FAC-2", subject_code="CPE201L"),
        ],
    )


def _valid_entries() -> list[ScheduledMeetingEntry]:
    return [
        ScheduledMeetingEntry(
            id="E1",
            offering_code="OFF-CE101",
            meeting_index=0,
            faculty_code="FAC-1",
            room_code="LEC-1",
            weekday=Weekday.MONDAY,
            start_min=450,
            end_min=540,
        ),
        ScheduledMeetingEntry(
            id="E2",
            offering_code="OFF-CE101",
            meeting_index=1,
            faculty_code="FAC-1",
            room_code="LEC-1",
            weekday=Weekday.WEDNESDAY,
            start_min=450,
            end_min=540,
        ),
        ScheduledMeetingEntry(
            id="E3",
            offering_code="OFF-CPE201L",
            meeting_index=0,
            faculty_code="FAC-2",
            room_code="LAB-1",
            weekday=Weekday.TUESDAY,
            start_min=540,
            end_min=630,
        ),
        ScheduledMeetingEntry(
            id="E4",
            offering_code="OFF-CPE201L",
            meeting_index=1,
            faculty_code="FAC-2",
            room_code="LAB-1",
            weekday=Weekday.THURSDAY,
            start_min=540,
            end_min=630,
        ),
    ]


def test_each_hard_constraint_hc01_to_hc15_can_be_violated_and_detected() -> None:
    """Exit Criterion 2: Each hard constraint HC-01 to HC-15 has a test proving detection."""
    base_prob = _base_problem()
    base_ent = _valid_entries()
    clean_res = validate_schedule(base_prob, base_ent)
    assert clean_res.valid is True
    assert clean_res.hard_violation_count == 0

    # HC-01: Faculty overlap (never waivable)
    ent_hc01 = [
        *base_ent[:2],
        base_ent[2].model_copy(
            update={
                "faculty_code": "FAC-1",
                "weekday": Weekday.MONDAY,
                "start_min": 480,
                "end_min": 570,
            }
        ),
        base_ent[3],
    ]
    res_hc01 = validate_schedule(
        base_prob.model_copy(
            update={
                "waivers": [
                    ExceptionWaiverModel(code=HardConstraintCode.HC_01, reason="Attempt waiver")
                ]
            }
        ),
        ent_hc01,
    )
    assert any(v.code == HardConstraintCode.HC_01 and not v.waived for v in res_hc01.violations)

    # HC-02: Room overlap (never waivable)
    ent_hc02 = [
        *base_ent[:2],
        base_ent[2].model_copy(
            update={
                "room_code": "LEC-1",
                "weekday": Weekday.MONDAY,
                "start_min": 450,
                "end_min": 540,
            }
        ),
        base_ent[3],
    ]
    res_hc02 = validate_schedule(base_prob, ent_hc02)
    assert any(v.code == HardConstraintCode.HC_02 for v in res_hc02.violations)

    # HC-03: Section overlap (never waivable)
    ent_hc03 = [
        base_ent[0],
        base_ent[1].model_copy(update={"weekday": Weekday.MONDAY}),
        *base_ent[2:],
    ]
    res_hc03 = validate_schedule(base_prob, ent_hc03)
    assert any(v.code == HardConstraintCode.HC_03 for v in res_hc03.violations)

    # HC-04: Room capacity fits section (waivable with documented reason)
    prob_hc04 = base_prob.model_copy(
        update={
            "rooms": [
                RoomModel(code="LEC-1", type=RoomType.LECTURE, capacity=20),
                RoomModel(code="LAB-1", type=RoomType.LAB, capacity=35),
            ]
        }
    )
    res_hc04 = validate_schedule(prob_hc04, base_ent)
    assert any(v.code == HardConstraintCode.HC_04 for v in res_hc04.violations)
    # Verify waiver works for HC-04
    res_hc04_waived = validate_schedule(
        prob_hc04.model_copy(
            update={
                "waivers": [
                    ExceptionWaiverModel(
                        code=HardConstraintCode.HC_04,
                        room_code="LEC-1",
                        reason="Dean approved temporary chairs",
                    )
                ]
            }
        ),
        base_ent,
    )
    assert res_hc04_waived.valid is True
    assert res_hc04_waived.waived_violation_count == 2

    # HC-05: Room type matches requirement
    ent_hc05 = [base_ent[0].model_copy(update={"room_code": "LAB-1"}), *base_ent[1:]]
    res_hc05 = validate_schedule(base_prob, ent_hc05)
    assert any(v.code == HardConstraintCode.HC_05 for v in res_hc05.violations)

    # HC-06: Faculty availability
    prob_hc06 = base_prob.model_copy(
        update={
            "faculty_availability": [
                AvailabilityWindow(
                    entity_code="FAC-1",
                    weekday=Weekday.MONDAY,
                    start_min=450,
                    end_min=600,
                    status="UNAVAILABLE",
                )
            ]
        }
    )
    res_hc06 = validate_schedule(prob_hc06, base_ent)
    assert any(v.code == HardConstraintCode.HC_06 for v in res_hc06.violations)

    # HC-07: Faculty max load
    prob_hc07 = base_prob.model_copy(
        update={
            "faculty": [
                base_prob.faculty[0].model_copy(update={"max_load_hours": 1.0}),
                base_prob.faculty[1],
            ]
        }
    )
    res_hc07 = validate_schedule(prob_hc07, base_ent)
    assert any(v.code == HardConstraintCode.HC_07 for v in res_hc07.violations)

    # HC-08: Required meetings and contact hours
    res_hc08 = validate_schedule(base_prob, base_ent[:-1])
    assert any(v.code == HardConstraintCode.HC_08 for v in res_hc08.violations)

    # HC-09: Faculty qualification
    prob_hc09 = base_prob.model_copy(update={"qualifications": [base_prob.qualifications[1]]})
    res_hc09 = validate_schedule(prob_hc09, base_ent)
    assert any(v.code == HardConstraintCode.HC_09 for v in res_hc09.violations)

    # HC-10: Room availability
    prob_hc10 = base_prob.model_copy(
        update={
            "room_availability": [
                AvailabilityWindow(
                    entity_code="LEC-1",
                    weekday=Weekday.MONDAY,
                    start_min=450,
                    end_min=600,
                    status="UNAVAILABLE",
                )
            ]
        }
    )
    res_hc10 = validate_schedule(prob_hc10, base_ent)
    assert any(v.code == HardConstraintCode.HC_10 for v in res_hc10.violations)

    # HC-11: Allowed periods and official breaks (720-780 is lunch break)
    ent_hc11 = [
        base_ent[0].model_copy(update={"start_min": 690, "end_min": 780}),
        *base_ent[1:],
    ]
    res_hc11 = validate_schedule(base_prob, ent_hc11)
    assert any(v.code == HardConstraintCode.HC_11 for v in res_hc11.violations)

    # HC-12: Dean directives
    prob_hc12 = base_prob.model_copy(
        update={
            "directives": [
                DirectiveModel(
                    id="DIR-NO-MON",
                    type=DirectiveType.FACULTY_NOT_ON_DAY,
                    hardness=ConstraintHardness.HARD,
                    approved=True,
                    faculty_code="FAC-1",
                    weekday=Weekday.MONDAY,
                )
            ]
        }
    )
    res_hc12 = validate_schedule(prob_hc12, base_ent)
    assert any(v.code == HardConstraintCode.HC_12 for v in res_hc12.violations)

    # HC-13: Duration and meeting pattern
    ent_hc13 = [
        base_ent[0].model_copy(update={"weekday": Weekday.TUESDAY}),
        *base_ent[1:],
    ]
    res_hc13 = validate_schedule(base_prob, ent_hc13)
    assert any(v.code == HardConstraintCode.HC_13 for v in res_hc13.violations)

    # HC-14: Calendar and maintenance restrictions
    prob_hc14 = base_prob.model_copy(
        update={
            "calendar_restrictions": [
                CalendarRestrictionModel(
                    room_code="LEC-1",
                    weekday=Weekday.MONDAY,
                    start_min=450,
                    end_min=540,
                    reason="AC Maintenance",
                )
            ]
        }
    )
    res_hc14 = validate_schedule(prob_hc14, base_ent)
    assert any(v.code == HardConstraintCode.HC_14 for v in res_hc14.violations)

    # HC-15: Fixed blocks (PATHFIT / GenEd)
    prob_hc15 = base_prob.model_copy(
        update={
            "fixed_blocks": [
                FixedBlockModel(
                    section_code="BSCE-1A",
                    weekday=Weekday.MONDAY,
                    start_min=450,
                    end_min=540,
                    label="PATHFIT 1",
                )
            ]
        }
    )
    res_hc15 = validate_schedule(prob_hc15, base_ent)
    assert any(v.code == HardConstraintCode.HC_15 for v in res_hc15.violations)


@given(
    student_count=st.integers(min_value=15, max_value=60),
    room_capacity=st.integers(min_value=15, max_value=60),
)
@hyp_settings(max_examples=25)
def test_hypothesis_validator_and_solver_invariants(
    student_count: int, room_capacity: int
) -> None:
    """Property-based test (2A.5): Solver never emits an unwaived HC-04 room capacity violation."""
    prob = _base_problem()
    prob.sections[0].student_count = student_count
    prob.rooms[0].capacity = room_capacity

    sol = solve_problem(prob, time_limit_seconds=3)
    assert sol.validation is not None
    # Any scheduled entries must never violate HC-04 (or any hard constraint other than HC-08)
    non_hc08 = [
        v for v in sol.validation.violations if not v.waived and v.code != HardConstraintCode.HC_08
    ]
    assert non_hc08 == []
    if student_count > room_capacity:
        assert any(
            u.offering_code == "OFF-CE101"
            and u.reason_code == UnscheduledReasonCode.NO_ROOM_CAPACITY
            for u in sol.unscheduled
        )
    else:
        assert len(sol.entries) == 4
        assert sol.validation.valid is True


def _load_fixture_problem(fixture_name: str) -> Problem:
    repo_root = Path(__file__).resolve().parents[3]
    fixture_path = repo_root / "fixtures" / f"{fixture_name}.json"
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))

    return Problem(
        term=TermConfig(
            code=raw["term"]["code"],
            slot_step_minutes=raw["term"].get("slotMinutes", 30),
            day_start_min=raw["term"]["dayStartMin"],
            day_end_min=raw["term"]["dayEndMin"],
        ),
        faculty=[
            FacultyModel(
                code=f["code"],
                name=f["name"],
                program_code=f.get("programCode"),
                employment_type=f["employmentType"],
                specialization=f.get("specialization", ""),
                max_load_units=f["maxLoadUnits"],
                max_load_hours=f["maxLoadHours"],
                status=f["status"],
            )
            for f in raw["faculty"]
        ],
        subjects=[
            SubjectModel(
                code=s["code"],
                name=s["name"],
                program_code=s.get("programCode"),
                year_level=s["yearLevel"],
                category=s["category"],
                units=s["units"],
                contact_hours=s["contactHours"],
                lecture_hours=s["lectureHours"],
                lab_hours=s["labHours"],
            )
            for s in raw["subjects"]
        ],
        sections=[
            SectionModel(
                code=sec["code"],
                program_code=sec["programCode"],
                year_level=sec["yearLevel"],
                student_count=sec["studentCount"],
            )
            for sec in raw["sections"]
        ],
        rooms=[
            RoomModel(
                code=r["code"],
                name=r["name"],
                type=r["type"],
                capacity=r["capacity"],
                status=r["status"],
            )
            for r in raw["rooms"]
        ],
        offerings=[
            OfferingModel(
                code=o["code"],
                section_code=o["sectionCode"],
                subject_code=o["subjectCode"],
                component=o["component"],
                meetings_per_week=o["meetingsPerWeek"],
                minutes_per_meeting=o["minutesPerMeeting"],
                meeting_pattern=o["meetingPattern"],
                required_room_type=o["requiredRoomType"],
                preassigned_faculty_code=o.get("preassignedFacultyCode"),
                combined_class_group=o.get("combinedClassGroup"),
            )
            for o in raw["offerings"]
        ],
        faculty_availability=[
            AvailabilityWindow(
                entity_code=a["facultyCode"],
                weekday=a["weekday"],
                start_min=a["startMin"],
                end_min=a["endMin"],
                status=a["status"],
            )
            for a in raw["facultyAvailability"]
        ],
        qualifications=[
            QualificationModel(
                faculty_code=q["facultyCode"],
                subject_code=q["subjectCode"],
            )
            for q in raw["facultyQualifications"]
        ],
        fixed_blocks=[
            FixedBlockModel(
                section_code=fb["sectionCode"],
                weekday=fb["weekday"],
                start_min=fb["startMin"],
                end_min=fb["endMin"],
                label=fb["label"],
            )
            for fb in raw["fixedBlocks"]
        ],
        faculty_preferences=[
            FacultyPreferenceModel(
                faculty_code=p["facultyCode"],
                type=p["type"],
                value=p["value"],
                weight=p["weight"],
                approved=True,
            )
            for p in raw["facultyPreferences"]
        ],
    )


def test_small_and_medium_fixtures_solve_with_zero_hard_violations() -> None:
    """Exit Criteria 1, 6, 7: Small and medium fixtures solve with 0 hard violations."""
    for name in ("small", "medium"):
        prob = _load_fixture_problem(name)
        sol = solve_problem(prob, profile_name="BALANCED", time_limit_seconds=15)
        assert sol.status in ("PROVEN_OPTIMAL", "BEST_FOUND")
        assert len(sol.unscheduled) == 0
        assert sol.validation is not None
        assert sol.validation.valid is True
        assert sol.validation.hard_violation_count == 0
        assert sol.solve_time_ms < settings.solver_time_limit_seconds * 1000

    # Regeneration stability check on small fixture (Exit Criterion 6)
    small_prob = _load_fixture_problem("small")
    sol_initial = solve_problem(small_prob, time_limit_seconds=5)
    small_prob_regen = small_prob.model_copy(update={"prior_entries": sol_initial.entries})
    sol_regen = solve_problem(small_prob_regen, time_limit_seconds=5)
    initial_slots = {
        (e.offering_code, e.meeting_index): (e.weekday, e.start_min, e.room_code)
        for e in sol_initial.entries
    }
    unchanged = sum(
        1
        for e in sol_regen.entries
        if initial_slots.get((e.offering_code, e.meeting_index))
        == (e.weekday, e.start_min, e.room_code)
    )
    assert unchanged >= len(sol_initial.entries) - 1


def _scaled_medium_problem(copies: int, staff_copies: int) -> Problem:
    """Medium fixture replicated `copies` times, with faculty and rooms replicated
    `staff_copies` times so the term stays feasible at the larger size."""
    base = _load_fixture_problem("medium")
    sections, offerings = [], []
    for i in range(copies):
        sections += [s.model_copy(update={"code": f"{s.code}-{i}"}) for s in base.sections]
        offerings += [
            o.model_copy(
                update={
                    "code": f"{o.code}-{i}",
                    "section_code": f"{o.section_code}-{i}",
                    "combined_class_group": None,
                    "preassigned_faculty_code": None,
                }
            )
            for o in base.offerings
        ]
    faculty, quals, fac_windows, rooms = [], [], [], []
    for j in range(staff_copies):
        faculty += [f.model_copy(update={"code": f"{f.code}-{j}"}) for f in base.faculty]
        quals += [
            q.model_copy(update={"faculty_code": f"{q.faculty_code}-{j}"})
            for q in base.qualifications
        ]
        fac_windows += [
            w.model_copy(update={"entity_code": f"{w.entity_code}-{j}"})
            for w in base.faculty_availability
        ]
        rooms += [r.model_copy(update={"code": f"{r.code}-{j}"}) for r in base.rooms]
    return base.model_copy(
        update={
            "sections": sections,
            "offerings": offerings,
            "faculty": faculty,
            "qualifications": quals,
            "faculty_availability": fac_windows,
            "rooms": rooms,
            "room_availability": [],
            "fixed_blocks": [],
            "faculty_preferences": [],
        }
    )


def test_solver_scales_to_a_multi_program_term() -> None:
    """Regression: the per-combination model left most meetings unscheduled at
    medium size. The decomposed model must place a 144-meeting term completely."""
    prob = _scaled_medium_problem(copies=3, staff_copies=2)
    assert sum(o.meetings_per_week for o in prob.offerings) == 144
    sol = solve_problem(prob, profile_name="BALANCED", time_limit_seconds=40)
    assert sol.status in ("PROVEN_OPTIMAL", "BEST_FOUND")
    assert len(sol.unscheduled) == 0
    assert sol.validation is not None
    assert sol.validation.hard_violation_count == 0


def test_combined_class_sections_share_slot_room_and_faculty() -> None:
    base = _load_fixture_problem("medium")
    lead, follower = (o for o in base.offerings if o.subject_code == "CE101")
    hall = base.rooms[0].model_copy(
        update={"code": "HALL-90", "capacity": 90, "type": RoomType.LECTURE}
    )

    def combined(pattern_follower: str) -> Problem:
        return base.model_copy(
            update={
                "rooms": [*base.rooms, hall],
                "offerings": [
                    o.model_copy(
                        update={
                            "combined_class_group": "G-CE101",
                            "meeting_pattern": lead.meeting_pattern
                            if o.code == lead.code
                            else pattern_follower,
                        }
                    )
                    if o.code in (lead.code, follower.code)
                    else o
                    for o in base.offerings
                ],
            }
        )

    sol = solve_problem(combined(lead.meeting_pattern), time_limit_seconds=20)
    assert sol.validation is not None
    assert sol.validation.hard_violation_count == 0
    assert len(sol.unscheduled) == 0
    slots = {
        code: sorted(
            (e.meeting_index, e.weekday, e.start_min, e.room_code, e.faculty_code)
            for e in sol.entries
            if e.offering_code == code
        )
        for code in (lead.code, follower.code)
    }
    assert slots[lead.code] == slots[follower.code]
    assert {s[3] for s in slots[lead.code]} == {"HALL-90"}

    # A follower whose meeting pattern can never match the leader's is left
    # unscheduled (HC-08) rather than placed on days that break its pattern (HC-13).
    clash = "TTH" if lead.meeting_pattern == "MWF" else "MWF"
    sol_clash = solve_problem(combined(clash), time_limit_seconds=20)
    assert sol_clash.validation is not None
    assert not [v for v in sol_clash.validation.violations if v.code.value == "HC-13"]


def test_impossible_fixtures_return_partial_candidates_with_diagnostic_reasons() -> None:
    """Exit Criterion 3: Impossible fixture returns partial candidate with accurate reason codes."""
    # Case 1: NO_QUALIFIED_FACULTY
    prob_no_qual = _base_problem()
    prob_no_qual.qualifications = [prob_no_qual.qualifications[0]]  # Remove CPE201L qualification
    sol1 = solve_problem(prob_no_qual, time_limit_seconds=3)
    assert len(sol1.entries) == 2
    assert len(sol1.unscheduled) == 2
    assert all(
        u.reason_code == UnscheduledReasonCode.NO_QUALIFIED_FACULTY for u in sol1.unscheduled
    )

    # Case 2: FACULTY_LOAD_FULL
    prob_load_full = _base_problem()
    prob_load_full.faculty[0].max_load_hours = 1.5  # Only enough for 1 of the 2 90m meetings
    sol2 = solve_problem(prob_load_full, time_limit_seconds=3)
    assert any(
        u.offering_code == "OFF-CE101"
        and u.reason_code == UnscheduledReasonCode.FACULTY_LOAD_FULL
        for u in sol2.unscheduled
    )
    assert sol2.validation is not None
    non_hc08 = [
        v for v in sol2.validation.violations if v.code != HardConstraintCode.HC_08
    ]
    assert non_hc08 == []


def test_alternatives_and_ml_endpoints() -> None:
    """Test POST /v1/alternatives, POST /v1/ml/train, and POST /v1/ml/recommend."""
    prob = _base_problem()
    entries = _valid_entries()
    alt_res = find_alternative_slots(
        AlternativesRequest(
            problem=prob,
            current_entries=entries,
            offering_code="OFF-CE101",
            meeting_index=0,
            max_results=5,
        )
    )
    assert len(alt_res.alternatives) > 0

    # Cold-start ML (0 samples) and 1-semester ML training (Phase 5 exit criteria)
    cold_train = train_fit_model(MLTrainRequest(samples=[]))
    assert cold_train.model_kind == "cold_start_similarity_v1"

    samples = [
        HistoricalAssignmentSample(
            faculty_code="FAC-1",
            subject_code="CE101",
            faculty_specialization="Structural Analysis Concrete Design",
            faculty_program_code="CE",
            subject_name="Structural Analysis",
            subject_description="Analysis of structures and frames",
            subject_program_code="CE",
            qualified=True,
            preference_weight=5.0,
            historical_count=2,
            accepted_by_dean=True,
        ),
        HistoricalAssignmentSample(
            faculty_code="FAC-2",
            subject_code="CE101",
            faculty_specialization="Embedded Systems Microprocessors",
            faculty_program_code="CPE",
            subject_name="Structural Analysis",
            subject_description="Analysis of structures and frames",
            subject_program_code="CE",
            qualified=False,
            preference_weight=0.0,
            historical_count=0,
            accepted_by_dean=False,
        ),
        HistoricalAssignmentSample(
            faculty_code="FAC-2",
            subject_code="CPE201L",
            faculty_specialization="Embedded Systems Microprocessors",
            faculty_program_code="CPE",
            subject_name="Embedded Systems Lab",
            subject_description="Microcontrollers and embedded firmware",
            subject_program_code="CPE",
            qualified=True,
            preference_weight=5.0,
            historical_count=2,
            accepted_by_dean=True,
        ),
        HistoricalAssignmentSample(
            faculty_code="FAC-1",
            subject_code="CPE201L",
            faculty_specialization="Structural Analysis Concrete Design",
            faculty_program_code="CE",
            subject_name="Embedded Systems Lab",
            subject_description="Microcontrollers and embedded firmware",
            subject_program_code="CPE",
            qualified=False,
            preference_weight=0.0,
            historical_count=0,
            accepted_by_dean=False,
        ),
    ]
    trained = train_fit_model(MLTrainRequest(samples=samples))
    assert trained.metrics.top1_accuracy == 1.0

    rec_res = recommend_faculty(
        MLRecommendRequest(
            parameters=trained.parameters,
            pairs=[
                FacultySubjectPair(
                    faculty_code="FAC-1",
                    subject_code="CE101",
                    faculty_specialization="Structural Analysis Concrete Design",
                    faculty_program_code="CE",
                    subject_name="Structural Analysis",
                    subject_description="Analysis of structures and frames",
                    subject_program_code="CE",
                    qualified=True,
                    historical_count=2,
                ),
                FacultySubjectPair(
                    faculty_code="FAC-2",
                    subject_code="CE101",
                    faculty_specialization="Embedded Systems Microprocessors",
                    faculty_program_code="CPE",
                    subject_name="Structural Analysis",
                    subject_description="Analysis of structures and frames",
                    subject_program_code="CE",
                    qualified=False,
                    historical_count=0,
                ),
            ],
        )
    )
    assert rec_res.recommendations[0].faculty_code == "FAC-1"
    assert rec_res.recommendations[0].rank == 1

    # Verify HTTP endpoints via FastAPI TestClient
    get_settings.cache_clear()
    headers = {"X-Engine-Token": get_settings().engine_token}
    client = TestClient(app)
    r_val = client.post(
        "/v1/validate",
        headers=headers,
        json={"problem": prob.model_dump(), "entries": [e.model_dump() for e in entries]},
    )
    assert r_val.status_code == 200
    assert r_val.json()["valid"] is True

    r_solve = client.post(
        "/v1/solve",
        headers=headers,
        json={"problem": prob.model_dump(), "profile_name": "BALANCED", "time_limit_seconds": 3},
    )
    assert r_solve.status_code == 202
    job_id = r_solve.json()["job_id"]

    r_job = client.get(f"/v1/solve/{job_id}", headers=headers)
    assert r_job.status_code == 200
    assert r_job.json()["status"] == "DONE"
