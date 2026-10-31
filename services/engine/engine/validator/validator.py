"""Independent plain-Python schedule validator and soft quality scorer (Phase 2A).

IMPORTANT ARCHITECTURE RULE (Section 2, Rules 2 & 3):
- This module is the single definition of "valid".
- It MUST NEVER import or share code with the OR-Tools CP-SAT solver (`engine.solver`).
"""

from collections import defaultdict

from engine.domain.models import (
    NEVER_WAIVABLE_CODES,
    ConstraintHardness,
    DirectiveType,
    HardConstraintCode,
    OfferingModel,
    Problem,
    QualityReport,
    ScheduledMeetingEntry,
    SoftConstraintCode,
    UnmetPreference,
    ValidationResponse,
    Violation,
    Weekday,
)


def _overlaps(start_a: int, end_a: int, start_b: int, end_b: int) -> bool:
    """Return True if half-open intervals [start_a, end_a) and [start_b, end_b) overlap."""
    return start_a < end_b and start_b < end_a


def _same_combined_group(
    a: ScheduledMeetingEntry,
    b: ScheduledMeetingEntry,
    offering_map: dict[str, OfferingModel],
) -> bool:
    """Return True if two entries belong to the same combined-class group at the same time."""
    off_a = offering_map.get(a.offering_code)
    off_b = offering_map.get(b.offering_code)
    if not off_a or not off_b:
        return False
    if not off_a.combined_class_group or not off_b.combined_class_group:
        return False
    return (
        off_a.combined_class_group == off_b.combined_class_group
        and a.weekday == b.weekday
        and a.start_min == b.start_min
        and a.end_min == b.end_min
    )


def check_hc_01_faculty_overlap(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-01: A faculty member teaches one class at a time."""
    offering_map = {o.code: o for o in problem.offerings}
    by_fac_day: dict[tuple[str, Weekday], list[ScheduledMeetingEntry]] = defaultdict(list)
    for e in entries:
        by_fac_day[(e.faculty_code, e.weekday)].append(e)

    violations: list[Violation] = []
    for (fac_code, day), group in by_fac_day.items():
        sorted_group = sorted(group, key=lambda x: (x.start_min, x.end_min, x.offering_code))
        n = len(sorted_group)
        for i in range(n):
            for j in range(i + 1, n):
                a = sorted_group[i]
                b = sorted_group[j]
                if _overlaps(a.start_min, a.end_min, b.start_min, b.end_min):
                    if _same_combined_group(a, b, offering_map):
                        continue
                    violations.append(
                        Violation(
                            code=HardConstraintCode.HC_01,
                            message=(
                                f"Faculty {fac_code} is double-booked on {day} "
                                f"({a.offering_code} [{a.start_min}-{a.end_min}] overlaps "
                                f"{b.offering_code} [{b.start_min}-{b.end_min}])."
                            ),
                            waivable=False,
                            entry_ids=[x for x in [a.id, b.id] if x],
                            offering_codes=[a.offering_code, b.offering_code],
                            faculty_codes=[fac_code],
                            room_codes=list({a.room_code, b.room_code}),
                            weekday=day,
                            start_min=max(a.start_min, b.start_min),
                            end_min=min(a.end_min, b.end_min),
                        )
                    )
    return violations


def check_hc_02_room_overlap(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-02: A room hosts one class at a time."""
    offering_map = {o.code: o for o in problem.offerings}
    by_room_day: dict[tuple[str, Weekday], list[ScheduledMeetingEntry]] = defaultdict(list)
    for e in entries:
        by_room_day[(e.room_code, e.weekday)].append(e)

    violations: list[Violation] = []
    for (room_code, day), group in by_room_day.items():
        sorted_group = sorted(group, key=lambda x: (x.start_min, x.end_min, x.offering_code))
        n = len(sorted_group)
        for i in range(n):
            for j in range(i + 1, n):
                a = sorted_group[i]
                b = sorted_group[j]
                if _overlaps(a.start_min, a.end_min, b.start_min, b.end_min):
                    if _same_combined_group(a, b, offering_map):
                        continue
                    violations.append(
                        Violation(
                            code=HardConstraintCode.HC_02,
                            message=(
                                f"Room {room_code} is double-booked on {day} "
                                f"({a.offering_code} [{a.start_min}-{a.end_min}] overlaps "
                                f"{b.offering_code} [{b.start_min}-{b.end_min}])."
                            ),
                            waivable=False,
                            entry_ids=[x for x in [a.id, b.id] if x],
                            offering_codes=[a.offering_code, b.offering_code],
                            faculty_codes=list({a.faculty_code, b.faculty_code}),
                            room_codes=[room_code],
                            weekday=day,
                            start_min=max(a.start_min, b.start_min),
                            end_min=min(a.end_min, b.end_min),
                        )
                    )
    return violations


def check_hc_03_section_overlap(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-03: A section attends one class at a time."""
    offering_map = {o.code: o for o in problem.offerings}
    by_sec_day: dict[tuple[str, Weekday], list[ScheduledMeetingEntry]] = defaultdict(list)
    for e in entries:
        off = offering_map.get(e.offering_code)
        if off:
            by_sec_day[(off.section_code, e.weekday)].append(e)

    violations: list[Violation] = []
    for (sec_code, day), group in by_sec_day.items():
        sorted_group = sorted(group, key=lambda x: (x.start_min, x.end_min, x.offering_code))
        n = len(sorted_group)
        for i in range(n):
            for j in range(i + 1, n):
                a = sorted_group[i]
                b = sorted_group[j]
                if _overlaps(a.start_min, a.end_min, b.start_min, b.end_min):
                    violations.append(
                        Violation(
                            code=HardConstraintCode.HC_03,
                            message=(
                                f"Section {sec_code} is double-booked on {day} "
                                f"({a.offering_code} [{a.start_min}-{a.end_min}] overlaps "
                                f"{b.offering_code} [{b.start_min}-{b.end_min}])."
                            ),
                            waivable=False,
                            entry_ids=[x for x in [a.id, b.id] if x],
                            offering_codes=[a.offering_code, b.offering_code],
                            section_codes=[sec_code],
                            weekday=day,
                            start_min=max(a.start_min, b.start_min),
                            end_min=min(a.end_min, b.end_min),
                        )
                    )
    return violations


def check_hc_04_room_capacity(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-04: Room capacity fits the section (or combined class sections)."""
    offering_map = {o.code: o for o in problem.offerings}
    section_map = {s.code: s for s in problem.sections}
    room_map = {r.code: r for r in problem.rooms}

    # Precompute combined group total students when simultaneous in same room
    combined_totals: dict[tuple[str, str, Weekday, int], int] = defaultdict(int)
    for e in entries:
        off = offering_map.get(e.offering_code)
        sec = section_map.get(off.section_code) if off else None
        if off and off.combined_class_group and sec:
            key = (off.combined_class_group, e.room_code, e.weekday, e.start_min)
            combined_totals[key] += sec.student_count

    violations: list[Violation] = []
    for e in entries:
        off = offering_map.get(e.offering_code)
        if not off:
            continue
        sec = section_map.get(off.section_code)
        room = room_map.get(e.room_code)
        if not sec or not room:
            continue
        required_seats = sec.student_count
        if off.combined_class_group:
            key = (off.combined_class_group, e.room_code, e.weekday, e.start_min)
            required_seats = max(required_seats, combined_totals[key])
        if room.capacity < required_seats:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_04,
                    message=(
                        f"Room {room.code} (capacity {room.capacity}) cannot fit "
                        f"section {sec.code} ({required_seats} students) for {off.code}."
                    ),
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[off.code],
                    room_codes=[room.code],
                    section_codes=[sec.code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
    return violations


def check_hc_05_room_type(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-05: Room type matches the requirement (lecture or laboratory)."""
    offering_map = {o.code: o for o in problem.offerings}
    room_map = {r.code: r for r in problem.rooms}

    violations: list[Violation] = []
    for e in entries:
        off = offering_map.get(e.offering_code)
        room = room_map.get(e.room_code)
        if not off or not room:
            continue
        if room.type != off.required_room_type:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_05,
                    message=(
                        f"Offering {off.code} requires room type {off.required_room_type}, "
                        f"but room {room.code} is {room.type}."
                    ),
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[off.code],
                    room_codes=[room.code],
                    section_codes=[off.section_code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
    return violations


def check_hc_06_faculty_availability(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-06: Faculty are scheduled only when available."""
    avail_by_fac: dict[str, list[ tuple[Weekday, int, int, str] ]] = defaultdict(list)
    for w in problem.faculty_availability:
        avail_by_fac[w.entity_code].append((w.weekday, w.start_min, w.end_min, w.status))

    violations: list[Violation] = []
    for e in entries:
        windows = avail_by_fac.get(e.faculty_code, [])
        if not windows:
            continue
        # Check explicit UNAVAILABLE windows
        unavail_hit = any(
            day == e.weekday
            and status == "UNAVAILABLE"
            and _overlaps(e.start_min, e.end_min, s, end)
            for (day, s, end, status) in windows
        )
        # If positive AVAILABLE/PREFERRED windows are specified for this faculty,
        # the meeting must fall inside at least one covering AVAILABLE/PREFERRED window.
        positive_windows = [
            (day, s, end)
            for (day, s, end, status) in windows
            if status in ("AVAILABLE", "PREFERRED")
        ]
        outside_positive = False
        if positive_windows:
            covered = any(
                day == e.weekday and s <= e.start_min and e.end_min <= end
                for (day, s, end) in positive_windows
            )
            outside_positive = not covered

        if unavail_hit or outside_positive:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_06,
                    message=(
                        f"Faculty {e.faculty_code} is unavailable on {e.weekday} "
                        f"[{e.start_min}-{e.end_min}] for {e.offering_code}."
                    ),
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[e.offering_code],
                    faculty_codes=[e.faculty_code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
    return violations


def check_hc_07_faculty_max_load(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-07: Faculty stay within maximum teaching load for their employment type."""
    fac_map = {f.code: f for f in problem.faculty}
    offering_map = {o.code: o for o in problem.offerings}
    subject_map = {s.code: s for s in problem.subjects}

    hours_by_fac: dict[str, float] = defaultdict(float)
    offerings_by_fac: dict[str, set[str]] = defaultdict(set)
    entry_ids_by_fac: dict[str, list[str]] = defaultdict(list)

    for e in entries:
        duration_hours = (e.end_min - e.start_min) / 60.0
        hours_by_fac[e.faculty_code] += duration_hours
        offerings_by_fac[e.faculty_code].add(e.offering_code)
        if e.id:
            entry_ids_by_fac[e.faculty_code].append(e.id)

    violations: list[Violation] = []
    for fac_code, total_hours in hours_by_fac.items():
        fac = fac_map.get(fac_code)
        if not fac:
            continue
        # Calculate assigned units across distinct offerings taught by this faculty
        total_units = 0.0
        for off_code in offerings_by_fac[fac_code]:
            off = offering_map.get(off_code)
            if not off:
                continue
            if off.units_override is not None:
                total_units += off.units_override
            else:
                subj = subject_map.get(off.subject_code)
                total_units += subj.units if subj else 3.0

        if total_hours > fac.max_load_hours + 1e-6 or total_units > fac.max_load_units + 1e-6:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_07,
                    message=(
                        f"Faculty {fac.code} exceeds max load "
                        f"({total_hours:.1f}h / {fac.max_load_hours:.1f}h max, "
                        f"{total_units:.1f}u / {fac.max_load_units:.1f}u max)."
                    ),
                    waivable=True,
                    entry_ids=entry_ids_by_fac[fac_code],
                    offering_codes=sorted(offerings_by_fac[fac_code]),
                    faculty_codes=[fac.code],
                )
            )
    return violations


def check_hc_08_required_meetings(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-08: All required meetings and contact hours are scheduled."""
    by_off: dict[str, list[ScheduledMeetingEntry]] = defaultdict(list)
    for e in entries:
        by_off[e.offering_code].append(e)

    violations: list[Violation] = []
    for off in problem.offerings:
        scheduled = by_off.get(off.code, [])
        req_count = off.meetings_per_week
        req_total_min = off.meetings_per_week * off.minutes_per_meeting
        actual_min = sum(e.end_min - e.start_min for e in scheduled)
        if len(scheduled) != req_count or actual_min != req_total_min:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_08,
                    message=(
                        f"Offering {off.code} requires {req_count} meetings "
                        f"({req_total_min} min/week), but {len(scheduled)} meetings "
                        f"({actual_min} min/week) are scheduled."
                    ),
                    waivable=True,
                    entry_ids=[e.id for e in scheduled if e.id],
                    offering_codes=[off.code],
                    section_codes=[off.section_code],
                )
            )
    return violations


def check_hc_09_faculty_qualification(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-09: Faculty specialization/qualification matches the subject."""
    offering_map = {o.code: o for o in problem.offerings}
    qualified_pairs = {(q.faculty_code, q.subject_code) for q in problem.qualifications}

    violations: list[Violation] = []
    for e in entries:
        off = offering_map.get(e.offering_code)
        if not off:
            continue
        if (e.faculty_code, off.subject_code) not in qualified_pairs:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_09,
                    message=(
                        f"Faculty {e.faculty_code} is not qualified to teach "
                        f"subject {off.subject_code} ({off.code})."
                    ),
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[off.code],
                    faculty_codes=[e.faculty_code],
                    section_codes=[off.section_code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
    return violations


def check_hc_10_room_availability(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-10: Rooms are used only when available (active status and room availability windows)."""
    room_map = {r.code: r for r in problem.rooms}
    avail_by_room: dict[str, list[tuple[Weekday, int, int, str]]] = defaultdict(list)
    for w in problem.room_availability:
        avail_by_room[w.entity_code].append((w.weekday, w.start_min, w.end_min, w.status))

    violations: list[Violation] = []
    for e in entries:
        room = room_map.get(e.room_code)
        if room and room.status != "ACTIVE":
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_10,
                    message=f"Room {e.room_code} is not active (status={room.status}).",
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[e.offering_code],
                    room_codes=[e.room_code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
            continue

        windows = avail_by_room.get(e.room_code, [])
        if not windows:
            continue
        unavail_hit = any(
            day == e.weekday
            and status == "UNAVAILABLE"
            and _overlaps(e.start_min, e.end_min, s, end)
            for (day, s, end, status) in windows
        )
        positive_windows = [
            (day, s, end)
            for (day, s, end, status) in windows
            if status in ("AVAILABLE", "PREFERRED")
        ]
        outside_positive = False
        if positive_windows:
            outside_positive = not any(
                day == e.weekday and s <= e.start_min and e.end_min <= end
                for (day, s, end) in positive_windows
            )
        if unavail_hit or outside_positive:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_10,
                    message=(
                        f"Room {e.room_code} is unavailable on {e.weekday} "
                        f"[{e.start_min}-{e.end_min}]."
                    ),
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[e.offering_code],
                    room_codes=[e.room_code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
    return violations


def check_hc_11_allowed_periods(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-11: Classes stay inside allowed periods and avoid official breaks."""
    allowed_days = set(problem.term.allowed_weekdays)
    day_start = problem.term.day_start_min
    day_end = problem.term.day_end_min
    breaks = problem.term.official_breaks

    violations: list[Violation] = []
    for e in entries:
        outside_window = (
            e.weekday not in allowed_days
            or e.start_min < day_start
            or e.end_min > day_end
            or e.end_min <= e.start_min
        )
        overlaps_break = any(_overlaps(e.start_min, e.end_min, b_s, b_e) for (b_s, b_e) in breaks)
        if outside_window or overlaps_break:
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_11,
                    message=(
                        f"Meeting for {e.offering_code} on {e.weekday} [{e.start_min}-{e.end_min}] "
                        f"is outside allowed operating hours [{day_start}-{day_end}] "
                        f"or overlaps an official break."
                    ),
                    waivable=True,
                    entry_ids=[e.id] if e.id else [],
                    offering_codes=[e.offering_code],
                    faculty_codes=[e.faculty_code],
                    room_codes=[e.room_code],
                    weekday=e.weekday,
                    start_min=e.start_min,
                    end_min=e.end_min,
                )
            )
    return violations


def check_hc_12_dean_directives(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-12: Dean directives marked as required (HARD and approved) are respected."""
    offering_map = {o.code: o for o in problem.offerings}
    violations: list[Violation] = []

    hard_directives = [
        d
        for d in problem.directives
        if d.hardness == ConstraintHardness.HARD and d.approved
    ]

    for d in hard_directives:
        for e in entries:
            off = offering_map.get(e.offering_code)
            sec_code = off.section_code if off else None

            if (
                d.type == DirectiveType.FACULTY_NOT_ON_DAY
                and d.faculty_code == e.faculty_code
                and d.weekday == e.weekday
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_12,
                        message=(
                            f"Directive {d.id} forbids faculty {e.faculty_code} "
                            f"from teaching on {e.weekday}."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        faculty_codes=[e.faculty_code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
            elif (
                d.type == DirectiveType.FACULTY_TIME_WINDOW
                and d.faculty_code == e.faculty_code
                and (d.weekday is None or d.weekday == e.weekday)
                and d.start_min is not None
                and d.end_min is not None
                and (e.start_min < d.start_min or e.end_min > d.end_min)
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_12,
                        message=(
                            f"Directive {d.id} requires faculty {e.faculty_code} within "
                            f"[{d.start_min}-{d.end_min}], got [{e.start_min}-{e.end_min}]."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        faculty_codes=[e.faculty_code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
            elif (
                d.type == DirectiveType.SECTION_TIME_WINDOW
                and d.section_code == sec_code
                and (d.weekday is None or d.weekday == e.weekday)
                and d.start_min is not None
                and d.end_min is not None
                and (e.start_min < d.start_min or e.end_min > d.end_min)
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_12,
                        message=(
                            f"Directive {d.id} requires section {sec_code} within "
                            f"[{d.start_min}-{d.end_min}], got [{e.start_min}-{e.end_min}]."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        section_codes=[sec_code] if sec_code else [],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
            elif (
                d.type == DirectiveType.AVOID_ROOM
                and d.room_code == e.room_code
                and (d.offering_code is None or d.offering_code == e.offering_code)
                and (d.faculty_code is None or d.faculty_code == e.faculty_code)
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_12,
                        message=(
                            f"Directive {d.id} forbids room {e.room_code} for {e.offering_code}."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        room_codes=[e.room_code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
            elif (
                d.type == DirectiveType.REQUIRE_ROOM
                and d.offering_code == e.offering_code
                and d.room_code is not None
                and e.room_code != d.room_code
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_12,
                        message=(
                            f"Directive {d.id} requires room {d.room_code} "
                            f"for {e.offering_code}, got {e.room_code}."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        room_codes=[e.room_code],
                    )
                )
            elif (
                d.type == DirectiveType.ASSIGN_FACULTY
                and d.offering_code == e.offering_code
                and d.faculty_code is not None
                and e.faculty_code != d.faculty_code
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_12,
                        message=(
                            f"Directive {d.id} requires faculty {d.faculty_code} "
                            f"for {e.offering_code}, got {e.faculty_code}."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        faculty_codes=[e.faculty_code],
                    )
                )
    return violations


def check_hc_13_duration_and_pattern(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-13: Each class follows its required duration and meeting pattern."""
    offering_map = {o.code: o for o in problem.offerings}
    by_off: dict[str, list[ScheduledMeetingEntry]] = defaultdict(list)
    for e in entries:
        by_off[e.offering_code].append(e)

    mwf_days = {Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY}
    tth_days = {Weekday.TUESDAY, Weekday.THURSDAY}

    violations: list[Violation] = []
    for off_code, group in by_off.items():
        off = offering_map.get(off_code)
        if not off:
            continue
        for e in group:
            duration = e.end_min - e.start_min
            if duration != off.minutes_per_meeting:
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_13,
                        message=(
                            f"Meeting for {off.code} on {e.weekday} has duration {duration} min, "
                            f"expected {off.minutes_per_meeting} min."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[off.code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
            if off.meeting_pattern == "MWF" and e.weekday not in mwf_days:
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_13,
                        message=f"Offering {off.code} requires MWF pattern, but is on {e.weekday}.",
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[off.code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
            elif off.meeting_pattern == "TTH" and e.weekday not in tth_days:
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_13,
                        message=f"Offering {off.code} requires TTH pattern, but is on {e.weekday}.",
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[off.code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )

        # Multiple meetings of the same offering must be on distinct weekdays
        days_used = [e.weekday for e in group]
        if len(days_used) != len(set(days_used)):
            violations.append(
                Violation(
                    code=HardConstraintCode.HC_13,
                    message=f"Offering {off.code} has multiple meetings on the same weekday.",
                    waivable=True,
                    entry_ids=[e.id for e in group if e.id],
                    offering_codes=[off.code],
                )
            )
    return violations


def check_hc_14_calendar_restrictions(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-14: Approved calendar and maintenance restrictions are respected."""
    violations: list[Violation] = []
    for e in entries:
        for r in problem.calendar_restrictions:
            room_matches = r.room_code is None or r.room_code == e.room_code
            if (
                room_matches
                and r.weekday == e.weekday
                and _overlaps(e.start_min, e.end_min, r.start_min, r.end_min)
            ):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_14,
                        message=(
                            f"Meeting for {e.offering_code} on {e.weekday} "
                            f"[{e.start_min}-{e.end_min}] conflicts with restriction "
                            f"'{r.reason}' [{r.start_min}-{r.end_min}]."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[e.offering_code],
                        room_codes=[e.room_code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
    return violations


def check_hc_15_fixed_blocks(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> list[Violation]:
    """HC-15: Sections stay clear of their fixed blocks (PATHFIT, GenEd, D-23)."""
    offering_map = {o.code: o for o in problem.offerings}
    blocks_by_sec_day: dict[tuple[str, Weekday], list[tuple[int, int, str]]] = defaultdict(list)
    for fb in problem.fixed_blocks:
        blocks_by_sec_day[(fb.section_code, fb.weekday)].append(
            (fb.start_min, fb.end_min, fb.label)
        )

    violations: list[Violation] = []
    for e in entries:
        off = offering_map.get(e.offering_code)
        if not off:
            continue
        blocks = blocks_by_sec_day.get((off.section_code, e.weekday), [])
        for b_start, b_end, label in blocks:
            if _overlaps(e.start_min, e.end_min, b_start, b_end):
                violations.append(
                    Violation(
                        code=HardConstraintCode.HC_15,
                        message=(
                            f"Section {off.section_code} meeting {off.code} on {e.weekday} "
                            f"[{e.start_min}-{e.end_min}] overlaps fixed block '{label}' "
                            f"[{b_start}-{b_end}]."
                        ),
                        waivable=True,
                        entry_ids=[e.id] if e.id else [],
                        offering_codes=[off.code],
                        section_codes=[off.section_code],
                        weekday=e.weekday,
                        start_min=e.start_min,
                        end_min=e.end_min,
                    )
                )
    return violations


def apply_waivers(problem: Problem, violations: list[Violation]) -> list[Violation]:
    """Mark waivable violations as waived when a matching documented exception exists (D-18)."""
    result: list[Violation] = []
    for v in violations:
        if v.code in NEVER_WAIVABLE_CODES or not v.waivable:
            result.append(v)
            continue
        matched_reason: str | None = None
        for w in problem.waivers:
            if w.code != v.code:
                continue
            off_ok = w.offering_code is None or w.offering_code in v.offering_codes
            fac_ok = w.faculty_code is None or w.faculty_code in v.faculty_codes
            room_ok = w.room_code is None or w.room_code in v.room_codes
            sec_ok = w.section_code is None or w.section_code in v.section_codes
            if off_ok and fac_ok and room_ok and sec_ok:
                matched_reason = w.reason
                break
        if matched_reason:
            result.append(v.model_copy(update={"waived": True, "waiver_reason": matched_reason}))
        else:
            result.append(v)
    return result


def compute_quality_report(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> QualityReport:
    """Compute soft-constraint penalties (SC-01 to SC-16) and unmet preferences."""
    weights = problem.soft_weights.weights
    penalties_by_code: dict[SoftConstraintCode, float] = {
        code: 0.0 for code in SoftConstraintCode
    }
    unmet: list[UnmetPreference] = []

    offering_map = {o.code: o for o in problem.offerings}
    section_map = {s.code: s for s in problem.sections}
    room_map = {r.code: r for r in problem.rooms}
    subject_map = {s.code: s for s in problem.subjects}

    # SC-01 (faculty preferred days/times) & SC-04 (preferred rooms)
    w_sc01 = weights.get(SoftConstraintCode.SC_01, 10.0)
    w_sc04 = weights.get(SoftConstraintCode.SC_04, 5.0)
    for pref in problem.faculty_preferences:
        if not pref.approved:
            continue
        fac_entries = [e for e in entries if e.faculty_code == pref.faculty_code]
        if not fac_entries:
            continue
        if pref.type == "AVOID_DAY":
            for e in fac_entries:
                if e.weekday.value == pref.value.upper():
                    pen = w_sc01 * max(pref.weight, 1.0) * 0.2
                    penalties_by_code[SoftConstraintCode.SC_01] += pen
                    unmet.append(
                        UnmetPreference(
                            code=SoftConstraintCode.SC_01,
                            description=(
                                f"Faculty {pref.faculty_code} prefers avoiding {pref.value}."
                            ),
                            penalty=round(pen, 2),
                            faculty_code=pref.faculty_code,
                            offering_code=e.offering_code,
                        )
                    )
        elif pref.type == "PREFERRED_TIME":
            val = pref.value.upper()
            for e in fac_entries:
                if ("MORNING" in val and e.start_min >= 720) or (
                    "AFTERNOON" in val and e.start_min < 720
                ):
                    pen = w_sc01 * 0.5
                    penalties_by_code[SoftConstraintCode.SC_01] += pen
                    unmet.append(
                        UnmetPreference(
                            code=SoftConstraintCode.SC_01,
                            description=(
                                f"Faculty {pref.faculty_code} prefers {pref.value}, "
                                f"but {e.offering_code} is at {e.start_min}m."
                            ),
                            penalty=round(pen, 2),
                            faculty_code=pref.faculty_code,
                            offering_code=e.offering_code,
                        )
                    )
        elif pref.type == "PREFERRED_ROOM":
            for e in fac_entries:
                if e.room_code != pref.value:
                    pen = w_sc04 * 0.5
                    penalties_by_code[SoftConstraintCode.SC_04] += pen
                    unmet.append(
                        UnmetPreference(
                            code=SoftConstraintCode.SC_04,
                            description=(
                                f"Faculty {pref.faculty_code} prefers room {pref.value}, "
                                f"assigned {e.room_code}."
                            ),
                            penalty=round(pen, 2),
                            faculty_code=pref.faculty_code,
                            offering_code=e.offering_code,
                        )
                    )

    # SC-02: Balance teaching loads
    w_sc02 = weights.get(SoftConstraintCode.SC_02, 8.0)
    hours_by_fac: dict[str, float] = {f.code: 0.0 for f in problem.faculty}
    for e in entries:
        hours_by_fac[e.faculty_code] = hours_by_fac.get(e.faculty_code, 0.0) + (
            (e.end_min - e.start_min) / 60.0
        )
    if len(hours_by_fac) > 1:
        vals = list(hours_by_fac.values())
        mean_h = sum(vals) / len(vals)
        avg_dev = sum(abs(v - mean_h) for v in vals) / len(vals)
        if avg_dev > 3.0:
            pen = (avg_dev - 3.0) * w_sc02 * 0.25
            penalties_by_code[SoftConstraintCode.SC_02] += pen

    # SC-03: Minimize vacant gaps (> 60m between consecutive classes on the same day)
    w_sc03 = weights.get(SoftConstraintCode.SC_03, 8.0)
    by_sec_day: dict[tuple[str, Weekday], list[ScheduledMeetingEntry]] = defaultdict(list)
    for e in entries:
        off = offering_map.get(e.offering_code)
        if off:
            by_sec_day[(off.section_code, e.weekday)].append(e)
    for (sec_code, day), group in by_sec_day.items():
        if len(group) < 2:
            continue
        s_group = sorted(group, key=lambda x: x.start_min)
        for i in range(len(s_group) - 1):
            gap = s_group[i + 1].start_min - s_group[i].end_min
            if gap > 90:
                pen = ((gap - 90) / 30.0) * (w_sc03 * 0.25)
                penalties_by_code[SoftConstraintCode.SC_03] += pen
                unmet.append(
                    UnmetPreference(
                        code=SoftConstraintCode.SC_03,
                        description=f"Section {sec_code} has a {gap}m vacant gap on {day}.",
                        penalty=round(pen, 2),
                        section_code=sec_code,
                    )
                )

    # SC-05: Distribute classes evenly across the week
    w_sc05 = weights.get(SoftConstraintCode.SC_05, 6.0)
    for (sec_code, day), group in by_sec_day.items():
        if len(group) > 4:
            pen = (len(group) - 4) * w_sc05 * 0.5
            penalties_by_code[SoftConstraintCode.SC_05] += pen
            unmet.append(
                UnmetPreference(
                    code=SoftConstraintCode.SC_05,
                    description=f"Section {sec_code} has {len(group)} classes clustered on {day}.",
                    penalty=round(pen, 2),
                    section_code=sec_code,
                )
            )

    # SC-06: Minimize changes from prior schedule on regeneration
    w_sc06 = weights.get(SoftConstraintCode.SC_06, 12.0)
    if problem.prior_entries:
        prior_by_key = {
            (pe.offering_code, pe.meeting_index): pe for pe in problem.prior_entries
        }
        for e in entries:
            pe = prior_by_key.get((e.offering_code, e.meeting_index))
            if pe and (
                pe.weekday != e.weekday
                or pe.start_min != e.start_min
                or pe.room_code != e.room_code
                or pe.faculty_code != e.faculty_code
            ):
                pen = w_sc06 * 0.5
                penalties_by_code[SoftConstraintCode.SC_06] += pen
                unmet.append(
                    UnmetPreference(
                        code=SoftConstraintCode.SC_06,
                        description=(
                            f"Meeting {e.offering_code}#{e.meeting_index} "
                            f"moved from prior baseline."
                        ),
                        penalty=round(pen, 2),
                        offering_code=e.offering_code,
                    )
                )

    # SC-07: Prefer faculty with a high ML fit score
    w_sc07 = weights.get(SoftConstraintCode.SC_07, 8.0)
    if problem.ml_fit_scores:
        for e in entries:
            off = offering_map.get(e.offering_code)
            if not off:
                continue
            fit = problem.ml_fit_scores.get(f"{e.faculty_code}:{off.subject_code}")
            if fit is not None and fit < 0.5:
                pen = (0.5 - fit) * w_sc07
                penalties_by_code[SoftConstraintCode.SC_07] += pen

    # SC-08: Room utilization efficiency (avoid huge rooms for tiny sections)
    w_sc08 = weights.get(SoftConstraintCode.SC_08, 6.0)
    for e in entries:
        off = offering_map.get(e.offering_code)
        sec = section_map.get(off.section_code) if off else None
        room = room_map.get(e.room_code)
        if sec and room and room.capacity - sec.student_count > 25:
            pen = ((room.capacity - sec.student_count - 25) / 10.0) * (w_sc08 * 0.2)
            penalties_by_code[SoftConstraintCode.SC_08] += pen

    # SC-09 (Evening classes for lower-year sections), SC-11 (Late labs), SC-16 (Very early starts)
    w_sc09 = weights.get(SoftConstraintCode.SC_09, 10.0)
    w_sc11 = weights.get(SoftConstraintCode.SC_11, 8.0)
    w_sc16 = weights.get(SoftConstraintCode.SC_16, 7.0)
    for e in entries:
        off = offering_map.get(e.offering_code)
        sec = section_map.get(off.section_code) if off else None
        # Evening = ends after 18:00 (1080m)
        if sec and sec.year_level <= 2 and e.end_min > 1080:
            pen = w_sc09 * 0.6
            penalties_by_code[SoftConstraintCode.SC_09] += pen
            unmet.append(
                UnmetPreference(
                    code=SoftConstraintCode.SC_09,
                    description=(
                        f"Lower-year section {sec.code} has evening class {e.offering_code} "
                        f"ending at {e.end_min}m."
                    ),
                    penalty=round(pen, 2),
                    section_code=sec.code,
                    offering_code=e.offering_code,
                )
            )
        if off and off.component.value == "LAB" and e.end_min > 1050:
            pen = w_sc11 * 0.5
            penalties_by_code[SoftConstraintCode.SC_11] += pen
            unmet.append(
                UnmetPreference(
                    code=SoftConstraintCode.SC_11,
                    description=f"Lab {off.code} ends late ({e.end_min}m).",
                    penalty=round(pen, 2),
                    offering_code=off.code,
                )
            )
        if e.start_min < 450:
            pen = w_sc16 * 0.5
            penalties_by_code[SoftConstraintCode.SC_16] += pen

    # SC-12: Spread major/math subjects (avoid >2 major/math meetings on one day for a section)
    w_sc12 = weights.get(SoftConstraintCode.SC_12, 6.0)
    for (_sec_code, _day), group in by_sec_day.items():
        heavy_count = 0
        for e in group:
            off = offering_map.get(e.offering_code)
            subj = subject_map.get(off.subject_code) if off else None
            if subj and subj.category in ("MAJOR", "MATH"):
                heavy_count += 1
        if heavy_count > 3:
            pen = (heavy_count - 3) * w_sc12 * 0.5
            penalties_by_code[SoftConstraintCode.SC_12] += pen

    total_penalty = round(sum(penalties_by_code.values()), 2)
    quality_score = round(max(0.0, 100.0 - min(100.0, total_penalty)), 2)

    return QualityReport(
        total_penalty=total_penalty,
        quality_score=quality_score,
        penalties_by_code={k: round(v, 2) for k, v in penalties_by_code.items()},
        unmet_preferences=unmet,
    )


def validate_schedule(
    problem: Problem, entries: list[ScheduledMeetingEntry]
) -> ValidationResponse:
    """Run all 15 independent hard constraint validators and compute the soft quality report."""
    raw_violations: list[Violation] = []
    raw_violations.extend(check_hc_01_faculty_overlap(problem, entries))
    raw_violations.extend(check_hc_02_room_overlap(problem, entries))
    raw_violations.extend(check_hc_03_section_overlap(problem, entries))
    raw_violations.extend(check_hc_04_room_capacity(problem, entries))
    raw_violations.extend(check_hc_05_room_type(problem, entries))
    raw_violations.extend(check_hc_06_faculty_availability(problem, entries))
    raw_violations.extend(check_hc_07_faculty_max_load(problem, entries))
    raw_violations.extend(check_hc_08_required_meetings(problem, entries))
    raw_violations.extend(check_hc_09_faculty_qualification(problem, entries))
    raw_violations.extend(check_hc_10_room_availability(problem, entries))
    raw_violations.extend(check_hc_11_allowed_periods(problem, entries))
    raw_violations.extend(check_hc_12_dean_directives(problem, entries))
    raw_violations.extend(check_hc_13_duration_and_pattern(problem, entries))
    raw_violations.extend(check_hc_14_calendar_restrictions(problem, entries))
    raw_violations.extend(check_hc_15_fixed_blocks(problem, entries))

    violations = apply_waivers(problem, raw_violations)
    unwaived_count = sum(1 for v in violations if not v.waived)
    waived_count = sum(1 for v in violations if v.waived)
    quality = compute_quality_report(problem, entries)

    return ValidationResponse(
        valid=unwaived_count == 0,
        hard_violation_count=unwaived_count,
        waived_violation_count=waived_count,
        violations=violations,
        quality=quality,
    )
