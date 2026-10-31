"""OR-Tools CP-SAT scheduling solver and alternative-slot finder (Phase 2B & 2C)."""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

from ortools.sat.python import cp_model

from engine.config import get_settings
from engine.domain.models import (
    WEEKDAY_ORDER,
    AlternativeSlot,
    AlternativesRequest,
    AlternativesResponse,
    ConstraintHardness,
    DirectiveType,
    OfferingModel,
    Problem,
    ScheduledMeetingEntry,
    SoftConstraintCode,
    Solution,
    SolveJobResponse,
    UnscheduledMeetingResult,
    UnscheduledReasonCode,
    Weekday,
)
from engine.validator.validator import validate_schedule

UNSCHEDULED_PENALTY = 100_000


def _overlaps(start_a: int, end_a: int, start_b: int, end_b: int) -> bool:
    return start_a < end_b and start_b < end_a


def map_to_week_axis(
    weekday: Weekday,
    minute_of_day: int,
    day_start_min: int,
    slots_per_day: int,
    slot_step_min: int,
) -> int:
    """Map (weekday, minute_of_day) onto a single integer week slot axis (2B.1)."""
    day_idx = WEEKDAY_ORDER.index(weekday)
    slot_in_day = (minute_of_day - day_start_min) // slot_step_min
    return day_idx * slots_per_day + slot_in_day


def _allowed_weekdays_for_offering(problem: Problem, off: OfferingModel) -> list[Weekday]:
    allowed = list(problem.term.allowed_weekdays)
    if off.meeting_pattern == "MWF":
        return [
            d
            for d in allowed
            if d in (Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY)
        ]
    if off.meeting_pattern == "TTH":
        return [d for d in allowed if d in (Weekday.TUESDAY, Weekday.THURSDAY)]
    return allowed


def _candidate_start_mins(problem: Problem, duration_min: int) -> list[int]:
    step = max(15, problem.term.slot_step_minutes)
    starts: list[int] = []
    cur = problem.term.day_start_min
    while cur + duration_min <= problem.term.day_end_min:
        end = cur + duration_min
        if not any(_overlaps(cur, end, b_s, b_e) for (b_s, b_e) in problem.term.official_breaks):
            starts.append(cur)
        cur += step
    return starts


def _is_faculty_available_at(
    problem: Problem, fac_code: str, day: Weekday, start_min: int, end_min: int
) -> bool:
    windows = [w for w in problem.faculty_availability if w.entity_code == fac_code]
    if windows:
        if any(
            w.weekday == day
            and w.status == "UNAVAILABLE"
            and _overlaps(start_min, end_min, w.start_min, w.end_min)
            for w in windows
        ):
            return False
        pos = [w for w in windows if w.status in ("AVAILABLE", "PREFERRED")]
        if pos and not any(
            w.weekday == day and w.start_min <= start_min and end_min <= w.end_min
            for w in pos
        ):
            return False

    for d in problem.directives:
        if d.hardness != ConstraintHardness.HARD or not d.approved:
            continue
        if (
            d.type == DirectiveType.FACULTY_NOT_ON_DAY
            and d.faculty_code == fac_code
            and d.weekday == day
        ):
            return False
        if (
            d.type == DirectiveType.FACULTY_TIME_WINDOW
            and d.faculty_code == fac_code
            and (d.weekday is None or d.weekday == day)
            and d.start_min is not None
            and d.end_min is not None
            and (start_min < d.start_min or end_min > d.end_min)
        ):
            return False
    return True


def _is_room_available_at(
    problem: Problem,
    room_code: str,
    off_code: str,
    fac_code: str | None,
    day: Weekday,
    start_min: int,
    end_min: int,
) -> bool:
    windows = [w for w in problem.room_availability if w.entity_code == room_code]
    if windows:
        if any(
            w.weekday == day
            and w.status == "UNAVAILABLE"
            and _overlaps(start_min, end_min, w.start_min, w.end_min)
            for w in windows
        ):
            return False
        pos = [w for w in windows if w.status in ("AVAILABLE", "PREFERRED")]
        if pos and not any(
            w.weekday == day and w.start_min <= start_min and end_min <= w.end_min
            for w in pos
        ):
            return False

    for r in problem.calendar_restrictions:
        if (
            (r.room_code is None or r.room_code == room_code)
            and r.weekday == day
            and _overlaps(start_min, end_min, r.start_min, r.end_min)
        ):
            return False

    for d in problem.directives:
        if d.hardness != ConstraintHardness.HARD or not d.approved:
            continue
        if (
            d.type == DirectiveType.AVOID_ROOM
            and d.room_code == room_code
            and (d.offering_code is None or d.offering_code == off_code)
            and (d.faculty_code is None or fac_code is None or d.faculty_code == fac_code)
        ):
            return False
        if (
            d.type == DirectiveType.REQUIRE_ROOM
            and d.offering_code == off_code
            and d.room_code is not None
            and d.room_code != room_code
        ):
            return False
    return True


def _is_section_available_at(
    problem: Problem, sec_code: str, day: Weekday, start_min: int, end_min: int
) -> bool:
    for fb in problem.fixed_blocks:
        if (
            fb.section_code == sec_code
            and fb.weekday == day
            and _overlaps(start_min, end_min, fb.start_min, fb.end_min)
        ):
            return False

    for d in problem.directives:
        if d.hardness != ConstraintHardness.HARD or not d.approved:
            continue
        if (
            d.type == DirectiveType.SECTION_TIME_WINDOW
            and d.section_code == sec_code
            and (d.weekday is None or d.weekday == day)
            and d.start_min is not None
            and d.end_min is not None
            and (start_min < d.start_min or end_min > d.end_min)
        ):
            return False
    return True


def _diagnose_unscheduled_reason(
    problem: Problem,
    off: OfferingModel,
    qualified_fac: list[str],
    fitting_rooms: list[str],
    scheduled_hours_by_fac: dict[str, float],
    scheduled_units_by_fac: dict[str, float],
) -> tuple[UnscheduledReasonCode, str]:
    """Classify the exact diagnostic reason for an unscheduled meeting (Phase 2C)."""
    if not qualified_fac:
        return (
            UnscheduledReasonCode.NO_QUALIFIED_FACULTY,
            f"No active faculty member is qualified for subject {off.subject_code} ({off.code}).",
        )
    if not fitting_rooms:
        return (
            UnscheduledReasonCode.NO_ROOM_CAPACITY,
            (
                f"No active {off.required_room_type} room has sufficient "
                f"capacity for section {off.section_code}."
            ),
        )
    fac_map = {f.code: f for f in problem.faculty}
    subj_map = {s.code: s for s in problem.subjects}
    subj_units = (
        off.units_override
        if off.units_override is not None
        else (subj_map[off.subject_code].units if off.subject_code in subj_map else 3.0)
    )
    meeting_hours = off.minutes_per_meeting / 60.0

    all_full = True
    for f_code in qualified_fac:
        fac = fac_map.get(f_code)
        if not fac:
            continue
        cur_h = scheduled_hours_by_fac.get(f_code, 0.0)
        cur_u = scheduled_units_by_fac.get(f_code, 0.0)
        if cur_h + meeting_hours <= fac.max_load_hours + 1e-6 and (
            cur_u + subj_units <= fac.max_load_units + 1e-6
        ):
            all_full = False
            break

    if all_full:
        return (
            UnscheduledReasonCode.FACULTY_LOAD_FULL,
            (
                f"All qualified faculty ({', '.join(qualified_fac)}) have reached their "
                f"maximum teaching load for {off.code}."
            ),
        )
    return (
        UnscheduledReasonCode.NO_COMMON_SLOT,
        (
            f"No conflict-free time slot simultaneously satisfies section {off.section_code}, "
            f"qualified faculty ({', '.join(qualified_fac)}), and {off.required_room_type} rooms."
        ),
    )


def _soft_option_penalty(
    problem: Problem,
    off: OfferingModel,
    meeting_index: int,
    fac_code: str,
    room_code: str,
    day: Weekday,
    start_min: int,
    end_min: int,
    prior_lookup: dict[tuple[str, int], ScheduledMeetingEntry],
) -> int:
    """Compute integer soft-constraint penalty for a candidate choice."""
    weights = problem.soft_weights.weights
    sec_map = {s.code: s for s in problem.sections}
    room_map = {r.code: r for r in problem.rooms}
    sec = sec_map.get(off.section_code)
    room = room_map.get(room_code)

    pen = 0.0
    # SC-01 & SC-04: Faculty preferences
    w_sc01 = weights.get(SoftConstraintCode.SC_01, 10.0)
    w_sc04 = weights.get(SoftConstraintCode.SC_04, 5.0)
    for pref in problem.faculty_preferences:
        if not pref.approved or pref.faculty_code != fac_code:
            continue
        if pref.type == "AVOID_DAY" and pref.value.upper() == day.value:
            pen += w_sc01 * max(pref.weight, 1.0)
        elif pref.type == "PREFERRED_TIME":
            val = pref.value.upper()
            if ("MORNING" in val and start_min >= 720) or (
                "AFTERNOON" in val and start_min < 720
            ):
                pen += w_sc01 * 0.5
        elif pref.type == "PREFERRED_ROOM" and room_code != pref.value:
            pen += w_sc04 * 0.5

    # SC-06: Stability against prior schedule on regeneration
    w_sc06 = weights.get(SoftConstraintCode.SC_06, 12.0)
    pe = prior_lookup.get((off.code, meeting_index))
    if pe is not None:
        if pe.weekday != day or pe.start_min != start_min:
            pen += w_sc06 * 2.0
        if pe.room_code != room_code:
            pen += w_sc06 * 1.0
        if pe.faculty_code != fac_code:
            pen += w_sc06 * 1.5

    # SC-07: ML fit score
    w_sc07 = weights.get(SoftConstraintCode.SC_07, 8.0)
    fit = problem.ml_fit_scores.get(f"{fac_code}:{off.subject_code}")
    if fit is not None:
        pen += max(0.0, (1.0 - fit)) * w_sc07

    # SC-08: Room seat waste
    w_sc08 = weights.get(SoftConstraintCode.SC_08, 6.0)
    if sec and room and room.capacity > sec.student_count:
        excess = room.capacity - sec.student_count
        if excess > 20:
            pen += ((excess - 20) / 10.0) * (w_sc08 * 0.4)

    # SC-09: Avoid evening for lower-year sections
    w_sc09 = weights.get(SoftConstraintCode.SC_09, 10.0)
    if sec and sec.year_level <= 2 and end_min > 1080:
        pen += w_sc09 * 1.5

    # SC-10: Lower-year priority for mid-day slots
    w_sc10 = weights.get(SoftConstraintCode.SC_10, 7.0)
    if sec and sec.year_level <= 2 and end_min > 990:
        pen += w_sc10 * 0.4

    # SC-11: Keep labs away from late hours
    w_sc11 = weights.get(SoftConstraintCode.SC_11, 8.0)
    if off.component.value == "LAB" and end_min > 1050:
        pen += w_sc11 * 1.2

    # SC-16: Very early starts
    w_sc16 = weights.get(SoftConstraintCode.SC_16, 7.0)
    if start_min <= 450:
        pen += w_sc16 * 0.25

    return round(pen * 10)


def solve_problem(
    problem: Problem,
    profile_name: str = "BALANCED",
    time_limit_seconds: int | None = None,
) -> Solution:
    """Solve a scheduling Problem snapshot with OR-Tools CP-SAT and validate the result."""
    t0 = time.perf_counter()
    model = cp_model.CpModel()

    sec_map = {s.code: s for s in problem.sections}
    fac_map = {f.code: f for f in problem.faculty if f.status == "ACTIVE"}
    room_map = {r.code: r for r in problem.rooms if r.status == "ACTIVE"}
    subj_map = {s.code: s for s in problem.subjects}
    qual_by_subj: dict[str, list[str]] = defaultdict(list)
    for q in problem.qualifications:
        if q.faculty_code in fac_map:
            qual_by_subj[q.subject_code].append(q.faculty_code)

    prior_lookup: dict[tuple[str, int], ScheduledMeetingEntry] = {}
    by_off_prior: dict[str, list[ScheduledMeetingEntry]] = defaultdict(list)
    for pe in problem.prior_entries:
        by_off_prior[pe.offering_code].append(pe)
    for off_code, p_list in by_off_prior.items():
        s_list = sorted(p_list, key=lambda x: (WEEKDAY_ORDER.index(x.weekday), x.start_min))
        for idx, item in enumerate(s_list):
            m_idx = item.meeting_index if item.meeting_index > 0 else idx
            prior_lookup[(off_code, m_idx)] = item

    slot_step = max(15, problem.term.slot_step_minutes)
    slots_per_day = max(
        1, (problem.term.day_end_min - problem.term.day_start_min) // slot_step + 4
    )

    # Pre-analyze qualified faculty and fitting rooms per offering
    qualified_fac_by_off: dict[str, list[str]] = {}
    fitting_rooms_by_off: dict[str, list[str]] = {}

    # Combined-class group total student counts
    combined_group_students: dict[str, int] = defaultdict(int)
    for off in problem.offerings:
        sec = sec_map.get(off.section_code)
        if off.combined_class_group and sec:
            combined_group_students[off.combined_class_group] += sec.student_count

    for off in problem.offerings:
        # Qualified faculty
        q_facs = list(dict.fromkeys(qual_by_subj.get(off.subject_code, [])))
        if off.preassigned_faculty_code:
            q_facs = [f for f in q_facs if f == off.preassigned_faculty_code]
        for d in problem.directives:
            if (
                d.hardness == ConstraintHardness.HARD
                and d.approved
                and d.type == DirectiveType.ASSIGN_FACULTY
                and d.offering_code == off.code
                and d.faculty_code
            ):
                q_facs = [f for f in q_facs if f == d.faculty_code]
        qualified_fac_by_off[off.code] = q_facs

        # Fitting rooms
        sec = sec_map.get(off.section_code)
        req_cap = sec.student_count if sec else 0
        if off.combined_class_group:
            req_cap = max(req_cap, combined_group_students[off.combined_class_group])
        f_rooms = [
            r.code
            for r in room_map.values()
            if r.type == off.required_room_type and r.capacity >= req_cap
        ]
        fitting_rooms_by_off[off.code] = f_rooms

    # Build candidate options for each (offering, meeting_index)
    # Option tuple: (fac_code, room_code, weekday, start_min, end_min, soft_penalty)
    options_by_meeting: dict[
        tuple[str, int], list[tuple[str, str, Weekday, int, int, int]]
    ] = {}
    option_vars: dict[tuple[str, int, int], cp_model.IntVar] = {}
    scheduled_vars: dict[tuple[str, int], cp_model.IntVar] = {}

    fac_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    room_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    sec_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)

    # Track combined-class group leader so combined classes share identical slot/room/faculty
    combined_group_leader: dict[str, str] = {}
    for off in problem.offerings:
        if off.combined_class_group and off.combined_class_group not in combined_group_leader:
            combined_group_leader[off.combined_class_group] = off.code

    objective_terms: list[cp_model.LinearExpr | int] = []

    for off in problem.offerings:
        q_facs = qualified_fac_by_off[off.code]
        f_rooms = fitting_rooms_by_off[off.code]
        allowed_days = _allowed_weekdays_for_offering(problem, off)
        starts = _candidate_start_mins(problem, off.minutes_per_meeting)
        duration_slots = max(1, off.minutes_per_meeting // slot_step)

        for m_idx in range(off.meetings_per_week):
            m_key = (off.code, m_idx)
            sched_var = model.new_bool_var(f"sched_{off.code}_{m_idx}")
            scheduled_vars[m_key] = sched_var

            pinned_entry = prior_lookup.get(m_key)
            is_pinned = bool(pinned_entry and pinned_entry.pinned)

            opts: list[tuple[str, str, Weekday, int, int, int]] = []
            for fac_code in q_facs:
                for room_code in f_rooms:
                    for day in allowed_days:
                        for s_min in starts:
                            e_min = s_min + off.minutes_per_meeting
                            if is_pinned and pinned_entry is not None and (
                                fac_code != pinned_entry.faculty_code
                                or room_code != pinned_entry.room_code
                                or day != pinned_entry.weekday
                                or s_min != pinned_entry.start_min
                            ):
                                continue
                            if not _is_section_available_at(
                                problem, off.section_code, day, s_min, e_min
                            ):
                                continue
                            if not _is_faculty_available_at(
                                problem, fac_code, day, s_min, e_min
                            ):
                                continue
                            if not _is_room_available_at(
                                problem, room_code, off.code, fac_code, day, s_min, e_min
                            ):
                                continue
                            soft_pen = _soft_option_penalty(
                                problem,
                                off,
                                m_idx,
                                fac_code,
                                room_code,
                                day,
                                s_min,
                                e_min,
                                prior_lookup,
                            )
                            opts.append((fac_code, room_code, day, s_min, e_min, soft_pen))

            options_by_meeting[m_key] = opts
            if not opts:
                model.add(sched_var == 0)
            else:
                choice_bools: list[cp_model.IntVar] = []
                is_follower = (
                    off.combined_class_group is not None
                    and combined_group_leader.get(off.combined_class_group) != off.code
                )
                for o_idx, (fac_code, room_code, day, s_min, _e_min, soft_pen) in enumerate(
                    opts
                ):
                    b_var = model.new_bool_var(f"opt_{off.code}_{m_idx}_{o_idx}")
                    option_vars[(off.code, m_idx, o_idx)] = b_var
                    choice_bools.append(b_var)

                    axis_start = map_to_week_axis(
                        day,
                        s_min,
                        problem.term.day_start_min,
                        slots_per_day,
                        slot_step,
                    )
                    sec_iv = model.new_optional_fixed_size_interval_var(
                        axis_start,
                        duration_slots,
                        b_var,
                        f"sec_iv_{off.code}_{m_idx}_{o_idx}",
                    )
                    sec_intervals[off.section_code].append(sec_iv)

                    if not is_follower:
                        fac_iv = model.new_optional_fixed_size_interval_var(
                            axis_start,
                            duration_slots,
                            b_var,
                            f"fac_iv_{off.code}_{m_idx}_{o_idx}",
                        )
                        fac_intervals[fac_code].append(fac_iv)

                        room_iv = model.new_optional_fixed_size_interval_var(
                            axis_start,
                            duration_slots,
                            b_var,
                            f"room_iv_{off.code}_{m_idx}_{o_idx}",
                        )
                        room_intervals[room_code].append(room_iv)

                    if soft_pen > 0:
                        objective_terms.append(soft_pen * b_var)

                    prior_hint = prior_lookup.get(m_key)
                    if (
                        prior_hint is not None
                        and prior_hint.faculty_code == fac_code
                        and prior_hint.room_code == room_code
                        and prior_hint.weekday == day
                        and prior_hint.start_min == s_min
                    ):
                        model.add_hint(b_var, 1)
                        model.add_hint(sched_var, 1)

                model.add(sum(choice_bools) == sched_var)

            # Unscheduled penalty (D-07)
            objective_terms.append(UNSCHEDULED_PENALTY * (1 - sched_var))

        # HC-13: Distinct weekdays and consistent faculty across meetings of the same offering
        if off.meetings_per_week > 1:
            for allowed_day in allowed_days:
                day_vars: list[cp_model.IntVar] = []
                for m_idx in range(off.meetings_per_week):
                    opts = options_by_meeting[(off.code, m_idx)]
                    for o_idx, (_fc, _rc, opt_day, _sm, _em, _sp) in enumerate(opts):
                        if opt_day == allowed_day:
                            day_vars.append(option_vars[(off.code, m_idx, o_idx)])
                if day_vars:
                    model.add(sum(day_vars) <= 1)

            # Enforce ordering of weekdays across meeting_index (m_idx=0 earlier than m_idx=1)
            for m_idx in range(off.meetings_per_week - 1):
                opts_cur = options_by_meeting[(off.code, m_idx)]
                opts_nxt = options_by_meeting[(off.code, m_idx + 1)]
                if opts_cur and opts_nxt:
                    cur_day_expr = sum(
                        WEEKDAY_ORDER.index(opt[2]) * option_vars[(off.code, m_idx, o_idx)]
                        for o_idx, opt in enumerate(opts_cur)
                    )
                    nxt_day_expr = sum(
                        WEEKDAY_ORDER.index(opt[2]) * option_vars[(off.code, m_idx + 1, o_idx)]
                        for o_idx, opt in enumerate(opts_nxt)
                    )
                    # Only enforce when both meetings are scheduled
                    s_cur = scheduled_vars[(off.code, m_idx)]
                    s_nxt = scheduled_vars[(off.code, m_idx + 1)]
                    model.add(cur_day_expr + 1 <= nxt_day_expr).only_enforce_if(
                        [s_cur, s_nxt]
                    )

            # Consistent faculty across meetings of the same offering
            if len(q_facs) > 1:
                for f_code in q_facs:
                    for m_idx in range(off.meetings_per_week - 1):
                        f_cur = [
                            option_vars[(off.code, m_idx, o_idx)]
                            for o_idx, opt in enumerate(options_by_meeting[(off.code, m_idx)])
                            if opt[0] == f_code
                        ]
                        f_nxt = [
                            option_vars[(off.code, m_idx + 1, o_idx)]
                            for o_idx, opt in enumerate(
                                options_by_meeting[(off.code, m_idx + 1)]
                            )
                            if opt[0] == f_code
                        ]
                        s_cur = scheduled_vars[(off.code, m_idx)]
                        s_nxt = scheduled_vars[(off.code, m_idx + 1)]
                        model.add(sum(f_cur) == sum(f_nxt)).only_enforce_if([s_cur, s_nxt])

    # Synchronize combined-class followers with their leader
    for off in problem.offerings:
        if not off.combined_class_group:
            continue
        leader_code = combined_group_leader[off.combined_class_group]
        if off.code == leader_code:
            continue
        leader_off = next(o for o in problem.offerings if o.code == leader_code)
        for m_idx in range(min(off.meetings_per_week, leader_off.meetings_per_week)):
            l_opts = options_by_meeting.get((leader_code, m_idx), [])
            f_opts = options_by_meeting.get((off.code, m_idx), [])
            l_map = {
                (fc, rc, day, sm, em): option_vars[(leader_code, m_idx, o_idx)]
                for o_idx, (fc, rc, day, sm, em, _sp) in enumerate(l_opts)
            }
            for o_idx, (fc, rc, day, sm, em, _sp) in enumerate(f_opts):
                f_var = option_vars[(off.code, m_idx, o_idx)]
                l_var = l_map.get((fc, rc, day, sm, em))
                if l_var is not None:
                    model.add(f_var == l_var)
                else:
                    model.add(f_var == 0)

    # HC-01, HC-02, HC-03: NoOverlap per faculty, room, and section
    for ivs in fac_intervals.values():
        if len(ivs) > 1:
            model.add_no_overlap(ivs)
    for ivs in room_intervals.values():
        if len(ivs) > 1:
            model.add_no_overlap(ivs)
    for ivs in sec_intervals.values():
        if len(ivs) > 1:
            model.add_no_overlap(ivs)

    # HC-07: Faculty max teaching load (hours and units)
    for f_code, fac in fac_map.items():
        # Hours load (scaled by 60 to integer minutes)
        max_minutes = round(fac.max_load_hours * 60)
        min_terms: list[cp_model.LinearExpr | int] = []
        unit_terms: list[cp_model.LinearExpr | int] = []

        for off in problem.offerings:
            if (
                off.combined_class_group
                and combined_group_leader.get(off.combined_class_group) != off.code
            ):
                continue
            for m_idx in range(off.meetings_per_week):
                opts = options_by_meeting[(off.code, m_idx)]
                f_vars = [
                    option_vars[(off.code, m_idx, o_idx)]
                    for o_idx, opt in enumerate(opts)
                    if opt[0] == f_code
                ]
                if f_vars:
                    min_terms.append(off.minutes_per_meeting * sum(f_vars))

            # Units load per offering (scaled by 10 to integer tenths of a unit)
            opts_m0 = options_by_meeting.get((off.code, 0), [])
            f_vars_m0 = [
                option_vars[(off.code, 0, o_idx)]
                for o_idx, opt in enumerate(opts_m0)
                if opt[0] == f_code
            ]
            if f_vars_m0:
                subj = subj_map.get(off.subject_code)
                u_val = (
                    off.units_override
                    if off.units_override is not None
                    else (subj.units if subj else 3.0)
                )
                unit_terms.append(round(u_val * 10) * sum(f_vars_m0))

        if min_terms:
            model.add(sum(min_terms) <= max_minutes)
        if unit_terms:
            model.add(sum(unit_terms) <= round(fac.max_load_units * 10))

    model.minimize(sum(objective_terms))

    cfg = get_settings()
    solver = cp_model.CpSolver()
    limit_sec = (
        time_limit_seconds
        if time_limit_seconds is not None
        else cfg.solver_time_limit_seconds
    )
    solver.parameters.max_time_in_seconds = float(limit_sec)
    solver.parameters.num_search_workers = cfg.solver_workers

    raw_status = solver.solve(model)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    if raw_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return Solution(
            status="INFEASIBLE",
            profile_name=profile_name,
            entries=[],
            unscheduled=[],
            solve_time_ms=elapsed_ms,
        )

    entries: list[ScheduledMeetingEntry] = []
    scheduled_hours_by_fac: dict[str, float] = defaultdict(float)
    scheduled_units_by_fac: dict[str, float] = defaultdict(float)
    seen_fac_off: set[tuple[str, str]] = set()

    for off in problem.offerings:
        for m_idx in range(off.meetings_per_week):
            m_key = (off.code, m_idx)
            if solver.value(scheduled_vars[m_key]) == 1:
                opts = options_by_meeting[m_key]
                for o_idx, (fac_code, room_code, day, s_min, e_min, _sp) in enumerate(
                    opts
                ):
                    if solver.value(option_vars[(off.code, m_idx, o_idx)]) == 1:
                        prior_item = prior_lookup.get(m_key)
                        entries.append(
                            ScheduledMeetingEntry(
                                id=f"ENT-{off.code}-{m_idx}",
                                offering_code=off.code,
                                meeting_index=m_idx,
                                faculty_code=fac_code,
                                room_code=room_code,
                                weekday=day,
                                start_min=s_min,
                                end_min=e_min,
                                pinned=bool(prior_item and prior_item.pinned),
                            )
                        )
                        scheduled_hours_by_fac[fac_code] += (e_min - s_min) / 60.0
                        if (fac_code, off.code) not in seen_fac_off:
                            seen_fac_off.add((fac_code, off.code))
                            subj = subj_map.get(off.subject_code)
                            u_val = (
                                off.units_override
                                if off.units_override is not None
                                else (subj.units if subj else 3.0)
                            )
                            scheduled_units_by_fac[fac_code] += u_val
                        break

    unscheduled: list[UnscheduledMeetingResult] = []
    for off in problem.offerings:
        for m_idx in range(off.meetings_per_week):
            m_key = (off.code, m_idx)
            if solver.value(scheduled_vars[m_key]) == 0:
                r_code, r_detail = _diagnose_unscheduled_reason(
                    problem,
                    off,
                    qualified_fac_by_off[off.code],
                    fitting_rooms_by_off[off.code],
                    scheduled_hours_by_fac,
                    scheduled_units_by_fac,
                )
                unscheduled.append(
                    UnscheduledMeetingResult(
                        offering_code=off.code,
                        meeting_index=m_idx,
                        reason_code=r_code,
                        reason_detail=r_detail,
                    )
                )

    obj_val = float(solver.objective_value)
    bound_val = float(solver.best_objective_bound)
    gap_pct = (
        0.0
        if raw_status == cp_model.OPTIMAL or abs(obj_val) < 1e-6
        else round(max(0.0, (obj_val - bound_val) / max(1.0, abs(obj_val)) * 100.0), 2)
    )
    validation = validate_schedule(problem, entries)

    return Solution(
        status="PROVEN_OPTIMAL" if raw_status == cp_model.OPTIMAL else "BEST_FOUND",
        profile_name=profile_name,
        entries=entries,
        unscheduled=unscheduled,
        objective_value=round(obj_val / 10.0, 2),
        best_bound=round(bound_val / 10.0, 2),
        optimality_gap_pct=gap_pct,
        solve_time_ms=elapsed_ms,
        validation=validation,
    )


def find_alternative_slots(req: AlternativesRequest) -> AlternativesResponse:
    """Return feasible slots and rooms for one meeting ranked by quality impact (Phase 2C)."""
    problem = req.problem
    off = next((o for o in problem.offerings if o.code == req.offering_code), None)
    if off is None:
        return AlternativesResponse(
            offering_code=req.offering_code,
            meeting_index=req.meeting_index,
            alternatives=[],
        )

    baseline_val = validate_schedule(problem, req.current_entries)
    baseline_score = baseline_val.quality.quality_score

    other_entries = [
        e
        for e in req.current_entries
        if not (
            e.offering_code == req.offering_code and e.meeting_index == req.meeting_index
        )
    ]
    current_target = next(
        (
            e
            for e in req.current_entries
            if e.offering_code == req.offering_code
            and e.meeting_index == req.meeting_index
        ),
        None,
    )

    sec_map = {s.code: s for s in problem.sections}
    sec = sec_map.get(off.section_code)
    req_cap = sec.student_count if sec else 0

    cand_rooms = [
        r.code
        for r in problem.rooms
        if r.status == "ACTIVE"
        and r.type == off.required_room_type
        and r.capacity >= req_cap
    ]
    qual_facs = [
        q.faculty_code
        for q in problem.qualifications
        if q.subject_code == off.subject_code
    ]
    if current_target and current_target.faculty_code in qual_facs:
        # Prioritize keeping the same faculty member first
        qual_facs = [current_target.faculty_code] + [
            f for f in qual_facs if f != current_target.faculty_code
        ]

    allowed_days = _allowed_weekdays_for_offering(problem, off)
    starts = _candidate_start_mins(problem, off.minutes_per_meeting)

    candidates: list[AlternativeSlot] = []
    for fac_code in qual_facs:
        for day in allowed_days:
            for s_min in starts:
                e_min = s_min + off.minutes_per_meeting
                if (
                    current_target
                    and current_target.weekday == day
                    and current_target.start_min == s_min
                    and current_target.faculty_code == fac_code
                ):
                    continue
                for room_code in cand_rooms:
                    trial_entry = ScheduledMeetingEntry(
                        id=current_target.id if current_target else f"ALT-{off.code}",
                        offering_code=off.code,
                        meeting_index=req.meeting_index,
                        faculty_code=fac_code,
                        room_code=room_code,
                        weekday=day,
                        start_min=s_min,
                        end_min=e_min,
                        pinned=False,
                    )
                    trial_res = validate_schedule(problem, [*other_entries, trial_entry])
                    # Must introduce zero new hard violations (ignoring HC-08 if partial schedule)
                    non_hc08 = [
                        v
                        for v in trial_res.violations
                        if not v.waived and v.code.value != "HC-08"
                    ]
                    if not non_hc08:
                        new_score = trial_res.quality.quality_score
                        delta = round(new_score - baseline_score, 2)
                        candidates.append(
                            AlternativeSlot(
                                weekday=day,
                                start_min=s_min,
                                end_min=e_min,
                                room_code=room_code,
                                faculty_code=fac_code,
                                quality_delta=delta,
                                resulting_quality_score=new_score,
                            )
                        )

    candidates.sort(
        key=lambda c: (-c.resulting_quality_score, WEEKDAY_ORDER.index(c.weekday), c.start_min)
    )
    return AlternativesResponse(
        offering_code=req.offering_code,
        meeting_index=req.meeting_index,
        alternatives=candidates[: req.max_results],
    )


@dataclass
class _JobRecord:
    job_id: str
    status: Literal["QUEUED", "RUNNING", "DONE", "CANCELLED", "FAILED"] = "QUEUED"
    progress_pct: int = 0
    solution: Solution | None = None
    error: str | None = None


@dataclass
class SolveJobStore:
    """In-memory job registry for engine solve requests (Section 2 Engine API)."""

    jobs: dict[str, _JobRecord] = field(default_factory=dict)

    def create_and_run(
        self,
        problem: Problem,
        profile_name: str = "BALANCED",
        time_limit_seconds: int | None = None,
    ) -> SolveJobResponse:
        job_id = f"job-{uuid.uuid4().hex[:12]}"
        rec = _JobRecord(job_id=job_id, status="RUNNING", progress_pct=10)
        self.jobs[job_id] = rec
        try:
            sol = solve_problem(
                problem=problem,
                profile_name=profile_name,
                time_limit_seconds=time_limit_seconds,
            )
            rec.status = "DONE"
            rec.progress_pct = 100
            rec.solution = sol
        except Exception as exc:
            rec.status = "FAILED"
            rec.error = str(exc)
        return self.to_response(rec)

    def get(self, job_id: str) -> SolveJobResponse | None:
        rec = self.jobs.get(job_id)
        return self.to_response(rec) if rec else None

    def cancel(self, job_id: str) -> SolveJobResponse | None:
        rec = self.jobs.get(job_id)
        if not rec:
            return None
        rec.status = "CANCELLED"
        if rec.solution is None:
            rec.solution = Solution(status="CANCELLED")
        return self.to_response(rec)

    @staticmethod
    def to_response(rec: _JobRecord) -> SolveJobResponse:
        return SolveJobResponse(
            job_id=rec.job_id,
            status=rec.status,
            progress_pct=rec.progress_pct,
            solution=rec.solution,
            error=rec.error,
        )


job_store = SolveJobStore()
