"""Rules from the college's answers to the system-development questions.

- Rule 3(d): lower-year sections must not have evening classes (HC-16).
- Answer 11: a strict order of priority, so faculty preferences never outweigh
  the department's own preferences.
"""

from __future__ import annotations

from engine.domain.models import (
    AvailabilityWindow,
    ExceptionWaiverModel,
    FacultyPreferenceModel,
    HardConstraintCode,
    Problem,
    ScheduledMeetingEntry,
    SoftConstraintCode,
    Weekday,
)
from engine.solver.cpsat_solver import solve_problem
from engine.validator.validator import validate_schedule
from tests.test_phase2_and_phase5 import _base_problem, _valid_entries

EVENING = {"start_min": 1080, "end_min": 1170}  # 18:00 - 19:30


def _evening_entries() -> list[ScheduledMeetingEntry]:
    """Every meeting of the base schedule moved to 18:00-19:30."""
    return [e.model_copy(update=EVENING) for e in _valid_entries()]


def _hc16(problem: Problem, entries: list[ScheduledMeetingEntry]) -> list[bool]:
    """The `waived` flag of each HC-16 violation."""
    result = validate_schedule(problem, entries)
    return [v.waived for v in result.violations if v.code == HardConstraintCode.HC_16]


def test_hc16_flags_evening_classes_of_first_and_second_year_sections() -> None:
    # The base problem has a year 1 and a year 2 section, two meetings each.
    assert _hc16(_base_problem(), _evening_entries()) == [False] * 4
    assert _hc16(_base_problem(), _valid_entries()) == []


def test_hc16_ignores_upper_years_and_classes_ending_at_six() -> None:
    prob = _base_problem()
    upper = prob.model_copy(
        update={"sections": [s.model_copy(update={"year_level": 3}) for s in prob.sections]}
    )
    assert _hc16(upper, _evening_entries()) == []
    ends_at_six = [
        e.model_copy(update={"start_min": 990, "end_min": 1080}) for e in _valid_entries()
    ]
    assert _hc16(prob, ends_at_six) == []


def test_hc16_can_be_waived_as_a_documented_exception() -> None:
    prob = _base_problem().model_copy(
        update={
            "waivers": [
                ExceptionWaiverModel(
                    code=HardConstraintCode.HC_16,
                    section_code="BSCE-1A",
                    reason="Only evening laboratory time is left",
                )
            ]
        }
    )
    # The year 1 section's two meetings are waived; the year 2 section's are not.
    assert sorted(_hc16(prob, _evening_entries())) == [False, False, True, True]


def _evening_only_faculty(problem: Problem) -> Problem:
    """Both faculty members are available only from 17:00, so any class is evening."""
    windows = [
        AvailabilityWindow(entity_code=f.code, weekday=day, start_min=1020, end_min=1230)
        for f in problem.faculty
        for day in problem.term.allowed_weekdays
    ]
    return problem.model_copy(update={"faculty_availability": windows})


def test_solver_keeps_lower_year_sections_out_of_the_evening() -> None:
    prob = _evening_only_faculty(_base_problem())
    sol = solve_problem(prob, time_limit_seconds=5)
    # 17:00 + 90 minutes ends after 18:00, so no meeting can be placed.
    assert sol.entries == []
    assert len(sol.unscheduled) == 4


def test_solver_uses_the_evening_where_the_dean_waived_hc16() -> None:
    prob = _evening_only_faculty(_base_problem()).model_copy(
        update={
            "waivers": [
                ExceptionWaiverModel(
                    code=HardConstraintCode.HC_16,
                    section_code="BSCE-1A",
                    reason="Faculty teaches evenings only",
                )
            ]
        }
    )
    sol = solve_problem(prob, time_limit_seconds=5)
    placed = {e.offering_code for e in sol.entries}
    assert placed == {"OFF-CE101"}
    assert sol.validation is not None
    # The waived section's evening classes are recorded as waived; the only open
    # violation is the year 2 class that could not be placed (HC-08).
    hc16 = [v for v in sol.validation.violations if v.code == HardConstraintCode.HC_16]
    assert len(hc16) == 2 and all(v.waived for v in hc16)
    open_codes = {v.code for v in sol.validation.violations if not v.waived}
    assert open_codes == {HardConstraintCode.HC_08}


def _one_meeting_problem(prior_day: Weekday | None) -> Problem:
    """One weekly meeting whose faculty would rather not teach on Monday."""
    prob = _base_problem()
    offering = prob.offerings[0].model_copy(
        update={"meetings_per_week": 1, "meeting_pattern": "ANY"}
    )
    prior = (
        [
            ScheduledMeetingEntry(
                offering_code=offering.code,
                meeting_index=0,
                faculty_code="FAC-1",
                room_code="LEC-1",
                weekday=prior_day,
                start_min=480,
                end_min=570,
            )
        ]
        if prior_day
        else []
    )
    return prob.model_copy(
        update={
            "offerings": [offering],
            "prior_entries": prior,
            "faculty_preferences": [
                FacultyPreferenceModel(
                    faculty_code="FAC-1", type="AVOID_DAY", value="MONDAY", weight=5.0
                )
            ],
        }
    )


def test_faculty_preference_is_honoured_when_nothing_outranks_it() -> None:
    sol = solve_problem(_one_meeting_problem(prior_day=None), time_limit_seconds=5)
    assert len(sol.entries) == 1
    assert sol.entries[0].weekday != Weekday.MONDAY


def test_faculty_preference_never_outweighs_a_department_preference() -> None:
    # Keeping the existing schedule (SC-06) is the department's preference. Under a
    # weighted sum the faculty's avoid-Monday weight (500) beat the cost of moving
    # (240); under the strict order the department's preference wins.
    sol = solve_problem(_one_meeting_problem(prior_day=Weekday.MONDAY), time_limit_seconds=5)
    assert len(sol.entries) == 1
    assert (sol.entries[0].weekday, sol.entries[0].start_min) == (Weekday.MONDAY, 480)


def _with_preferences(*prefs: FacultyPreferenceModel) -> Problem:
    """The base term with one weekly meeting for FAC-1 and the given preferences."""
    prob = _one_meeting_problem(prior_day=None)
    return prob.model_copy(update={"faculty_preferences": list(prefs)})


def test_survey_time_window_is_honoured_by_the_solver_and_the_validator() -> None:
    pref = FacultyPreferenceModel(faculty_code="FAC-1", type="PREFERRED_TIME", value="13:00-16:00")
    sol = solve_problem(_with_preferences(pref), time_limit_seconds=5)
    entry = sol.entries[0]
    assert entry.start_min >= 780 and entry.end_min <= 960
    assert sol.validation is not None
    assert sol.validation.quality.penalties_by_code.get(SoftConstraintCode.SC_01, 0.0) == 0

    morning = [entry.model_copy(update={"start_min": 480, "end_min": 570})]
    quality = validate_schedule(_with_preferences(pref), morning).quality
    assert quality.penalties_by_code.get(SoftConstraintCode.SC_01, 0.0) > 0


def test_survey_preferred_days_are_honoured() -> None:
    prefs = [
        FacultyPreferenceModel(faculty_code="FAC-1", type="PREFERRED_DAY", value=day)
        for day in ("TUESDAY", "THURSDAY")
    ]
    sol = solve_problem(_with_preferences(*prefs), time_limit_seconds=5)
    assert sol.entries[0].weekday in (Weekday.TUESDAY, Weekday.THURSDAY)
    assert sol.validation is not None
    assert sol.validation.quality.penalties_by_code.get(SoftConstraintCode.SC_01, 0.0) == 0
