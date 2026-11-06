"""OR-Tools CP-SAT scheduling solver and alternative-slot finder (Phase 2B & 2C)."""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal

from ortools.sat.python import cp_model

from engine.config import get_settings
from engine.domain.models import (
    WEEKDAY_ORDER,
    AlternativeSlot,
    AlternativesRequest,
    AlternativesResponse,
    AvailabilityWindow,
    ConstraintHardness,
    DirectiveType,
    FacultyModel,
    FacultyPreferenceModel,
    OfferingModel,
    Problem,
    RoomModel,
    ScheduledMeetingEntry,
    SectionModel,
    SoftConstraintCode,
    Solution,
    SolveJobResponse,
    UnscheduledMeetingResult,
    UnscheduledReasonCode,
    Weekday,
)
from engine.domain.spread import SPREAD_PENALTY_FACTOR, daytime_peak_target
from engine.validator.validator import validate_schedule

UNSCHEDULED_PENALTY = 100_000
DAY_MINUTES = 1440


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


def _week_minute(weekday: Weekday, minute_of_day: int) -> int:
    """Exact minute offset on a single week axis (no slot rounding)."""
    return WEEKDAY_ORDER.index(weekday) * DAY_MINUTES + minute_of_day


def _allowed_weekdays_for_offering(problem: Problem, off: OfferingModel) -> list[Weekday]:
    allowed = list(problem.term.allowed_weekdays)
    if off.meeting_pattern == "MWF":
        return [d for d in allowed if d in (Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY)]
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


class _AvailabilityIndex:
    """Pre-indexed, memoized hard-availability checks for faculty, rooms and sections.

    The decomposed model asks the same (entity, day, start, end) questions for every
    meeting, so windows and directives are grouped once and answers are cached.
    """

    def __init__(self, problem: Problem) -> None:
        self._problem = problem
        self._fac_windows: dict[str, list[AvailabilityWindow]] = defaultdict(list)
        for w in problem.faculty_availability:
            self._fac_windows[w.entity_code].append(w)
        self._room_windows: dict[str, list[AvailabilityWindow]] = defaultdict(list)
        for w in problem.room_availability:
            self._room_windows[w.entity_code].append(w)
        self._hard_directives = [
            d for d in problem.directives if d.hardness == ConstraintHardness.HARD and d.approved
        ]
        self._fac_cache: dict[tuple[str, Weekday, int, int], bool] = {}
        self._room_cache: dict[tuple[str, str, Weekday, int, int], bool] = {}
        self._sec_cache: dict[tuple[str, Weekday, int, int], bool] = {}

    @staticmethod
    def _windows_allow(
        windows: list[AvailabilityWindow], day: Weekday, start_min: int, end_min: int
    ) -> bool:
        if not windows:
            return True
        if any(
            w.weekday == day
            and w.status == "UNAVAILABLE"
            and _overlaps(start_min, end_min, w.start_min, w.end_min)
            for w in windows
        ):
            return False
        positive = [w for w in windows if w.status in ("AVAILABLE", "PREFERRED")]
        return not positive or any(
            w.weekday == day and w.start_min <= start_min and end_min <= w.end_min for w in positive
        )

    def faculty(self, fac_code: str, day: Weekday, start_min: int, end_min: int) -> bool:
        key = (fac_code, day, start_min, end_min)
        cached = self._fac_cache.get(key)
        if cached is not None:
            return cached
        ok = self._windows_allow(self._fac_windows.get(fac_code, []), day, start_min, end_min)
        if ok:
            for d in self._hard_directives:
                if d.faculty_code != fac_code:
                    continue
                if d.type == DirectiveType.FACULTY_NOT_ON_DAY and d.weekday == day:
                    ok = False
                    break
                if (
                    d.type == DirectiveType.FACULTY_TIME_WINDOW
                    and (d.weekday is None or d.weekday == day)
                    and d.start_min is not None
                    and d.end_min is not None
                    and (start_min < d.start_min or end_min > d.end_min)
                ):
                    ok = False
                    break
        self._fac_cache[key] = ok
        return ok

    def room(
        self, room_code: str, off_code: str, day: Weekday, start_min: int, end_min: int
    ) -> bool:
        """Room availability independent of the faculty choice.

        Faculty-scoped AVOID_ROOM directives are handled separately as
        (faculty, room) exclusion clauses; see `faculty_room_exclusions`.
        """
        key = (room_code, off_code, day, start_min, end_min)
        cached = self._room_cache.get(key)
        if cached is not None:
            return cached
        ok = self._windows_allow(self._room_windows.get(room_code, []), day, start_min, end_min)
        if ok:
            ok = not any(
                (r.room_code is None or r.room_code == room_code)
                and r.weekday == day
                and _overlaps(start_min, end_min, r.start_min, r.end_min)
                for r in self._problem.calendar_restrictions
            )
        if ok:
            for d in self._hard_directives:
                if (
                    d.type == DirectiveType.AVOID_ROOM
                    and d.faculty_code is None
                    and d.room_code == room_code
                    and (d.offering_code is None or d.offering_code == off_code)
                ):
                    ok = False
                    break
                if (
                    d.type == DirectiveType.REQUIRE_ROOM
                    and d.offering_code == off_code
                    and d.room_code is not None
                    and d.room_code != room_code
                ):
                    ok = False
                    break
        self._room_cache[key] = ok
        return ok

    def faculty_room_exclusions(self, off_code: str) -> list[tuple[str, str]]:
        """(faculty, room) pairs forbidden for an offering by faculty-scoped AVOID_ROOM."""
        return [
            (d.faculty_code, d.room_code)
            for d in self._hard_directives
            if d.type == DirectiveType.AVOID_ROOM
            and d.faculty_code is not None
            and d.room_code is not None
            and (d.offering_code is None or d.offering_code == off_code)
        ]

    def section(self, sec_code: str, day: Weekday, start_min: int, end_min: int) -> bool:
        key = (sec_code, day, start_min, end_min)
        cached = self._sec_cache.get(key)
        if cached is not None:
            return cached
        ok = not any(
            fb.section_code == sec_code
            and fb.weekday == day
            and _overlaps(start_min, end_min, fb.start_min, fb.end_min)
            for fb in self._problem.fixed_blocks
        )
        if ok:
            for d in self._hard_directives:
                if (
                    d.type == DirectiveType.SECTION_TIME_WINDOW
                    and d.section_code == sec_code
                    and (d.weekday is None or d.weekday == day)
                    and d.start_min is not None
                    and d.end_min is not None
                    and (start_min < d.start_min or end_min > d.end_min)
                ):
                    ok = False
                    break
        self._sec_cache[key] = ok
        return ok


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


def _time_penalty(
    problem: Problem,
    off: OfferingModel,
    sec: SectionModel | None,
    day: Weekday,
    start_min: int,
    end_min: int,
    prior_entry: ScheduledMeetingEntry | None,
) -> int:
    """Soft penalty that depends only on the chosen (day, start) of a meeting."""
    weights = problem.soft_weights.weights
    pen = 0.0
    # SC-06: Stability against prior schedule (time component)
    if prior_entry is not None and (
        prior_entry.weekday != day or prior_entry.start_min != start_min
    ):
        pen += weights.get(SoftConstraintCode.SC_06, 12.0) * 2.0
    # SC-09: Avoid evening for lower-year sections
    if sec and sec.year_level <= 2 and end_min > 1080:
        pen += weights.get(SoftConstraintCode.SC_09, 10.0) * 1.5
    # SC-10: Lower-year priority for mid-day slots
    if sec and sec.year_level <= 2 and end_min > 990:
        pen += weights.get(SoftConstraintCode.SC_10, 7.0) * 0.4
    # SC-11: Keep labs away from late hours
    if off.component.value == "LAB" and end_min > 1050:
        pen += weights.get(SoftConstraintCode.SC_11, 8.0) * 1.2
    # SC-16: Very early starts
    if start_min <= 450:
        pen += weights.get(SoftConstraintCode.SC_16, 7.0) * 0.25
    return round(pen * 10)


def _room_penalty(
    problem: Problem,
    sec: SectionModel | None,
    room: RoomModel | None,
    prior_entry: ScheduledMeetingEntry | None,
) -> int:
    """Soft penalty that depends only on the chosen room of a meeting."""
    weights = problem.soft_weights.weights
    pen = 0.0
    # SC-06: Stability against prior schedule (room component)
    if prior_entry is not None and room is not None and prior_entry.room_code != room.code:
        pen += weights.get(SoftConstraintCode.SC_06, 12.0) * 1.0
    # SC-08: Room seat waste
    if sec and room and room.capacity > sec.student_count:
        excess = room.capacity - sec.student_count
        if excess > 20:
            pen += ((excess - 20) / 10.0) * (weights.get(SoftConstraintCode.SC_08, 6.0) * 0.4)
    return round(pen * 10)


def _faculty_penalty(
    problem: Problem,
    off: OfferingModel,
    fac_code: str,
    prior_entry: ScheduledMeetingEntry | None,
) -> int:
    """Soft penalty that depends only on the chosen faculty of a meeting."""
    weights = problem.soft_weights.weights
    pen = 0.0
    # SC-06: Stability against prior schedule (faculty component)
    if prior_entry is not None and prior_entry.faculty_code != fac_code:
        pen += weights.get(SoftConstraintCode.SC_06, 12.0) * 1.5
    # SC-07: ML fit score
    fit = problem.ml_fit_scores.get(f"{fac_code}:{off.subject_code}")
    if fit is not None:
        pen += max(0.0, 1.0 - fit) * weights.get(SoftConstraintCode.SC_07, 8.0)
    return round(pen * 10)


@dataclass
class _MeetingVars:
    """CP-SAT variables for one weekly meeting of an offering.

    The model is decomposed: a meeting chooses ONE time option, ONE room and ONE
    faculty member through three independent groups of booleans, instead of one
    boolean per (faculty x room x day x start) combination. Combined-class
    followers share their leader's time/room/faculty variables but keep their own
    `sched` literal and section interval.
    """

    off: OfferingModel
    m_idx: int
    sched: cp_model.IntVar
    times: list[tuple[Weekday, int, int]]
    t_vars: list[cp_model.IntVar]
    y_vars: dict[str, cp_model.IntVar]
    x_vars: dict[str, cp_model.IntVar]
    start: cp_model.IntVar | None
    day_expr: cp_model.LinearExpr | int = 0
    day_bools: dict[Weekday, list[cp_model.IntVar]] = field(default_factory=dict)
    # (penalty literal z, faculty literal x, violating literals); z = x AND any(hits)
    pref_terms: list[tuple[cp_model.IntVar, cp_model.IntVar, list[cp_model.IntVar]]] = field(
        default_factory=list
    )


@dataclass
class _GreedyState:
    fac_busy: dict[tuple[str, Weekday], list[tuple[int, int]]] = field(
        default_factory=lambda: defaultdict(list)
    )
    room_busy: dict[tuple[str, Weekday], list[tuple[int, int]]] = field(
        default_factory=lambda: defaultdict(list)
    )
    sec_busy: dict[tuple[str, Weekday], list[tuple[int, int]]] = field(
        default_factory=lambda: defaultdict(list)
    )
    fac_minutes: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    fac_units: dict[str, float] = field(default_factory=lambda: defaultdict(float))


def _free(busy: list[tuple[int, int]], start_min: int, end_min: int) -> bool:
    return not any(_overlaps(start_min, end_min, s, e) for (s, e) in busy)


def solve_problem(
    problem: Problem,
    profile_name: str = "BALANCED",
    time_limit_seconds: int | None = None,
) -> Solution:
    """Solve a scheduling Problem snapshot with OR-Tools CP-SAT and validate the result."""
    t0 = time.perf_counter()
    model = cp_model.CpModel()
    avail = _AvailabilityIndex(problem)
    weights = problem.soft_weights.weights
    w_sc01 = weights.get(SoftConstraintCode.SC_01, 10.0)
    w_sc04 = weights.get(SoftConstraintCode.SC_04, 5.0)

    sec_map = {s.code: s for s in problem.sections}
    fac_map = {f.code: f for f in problem.faculty if f.status == "ACTIVE"}
    room_map = {r.code: r for r in problem.rooms if r.status == "ACTIVE"}
    subj_map = {s.code: s for s in problem.subjects}
    off_by_code = {o.code: o for o in problem.offerings}
    qual_by_subj: dict[str, list[str]] = defaultdict(list)
    for q in problem.qualifications:
        if q.faculty_code in fac_map:
            qual_by_subj[q.subject_code].append(q.faculty_code)

    prefs_by_fac: dict[str, list[FacultyPreferenceModel]] = defaultdict(list)
    for pref in problem.faculty_preferences:
        if pref.approved:
            prefs_by_fac[pref.faculty_code].append(pref)

    prior_lookup: dict[tuple[str, int], ScheduledMeetingEntry] = {}
    by_off_prior: dict[str, list[ScheduledMeetingEntry]] = defaultdict(list)
    for pe in problem.prior_entries:
        by_off_prior[pe.offering_code].append(pe)
    for off_code, p_list in by_off_prior.items():
        s_list = sorted(p_list, key=lambda x: (WEEKDAY_ORDER.index(x.weekday), x.start_min))
        for idx, item in enumerate(s_list):
            m_idx = item.meeting_index if item.meeting_index > 0 else idx
            prior_lookup[(off_code, m_idx)] = item

    def units_of(off: OfferingModel) -> float:
        if off.units_override is not None:
            return off.units_override
        subj = subj_map.get(off.subject_code)
        return subj.units if subj else 3.0

    # Combined-class group total student counts and leaders
    combined_group_students: dict[str, int] = defaultdict(int)
    combined_group_leader: dict[str, str] = {}
    for off in problem.offerings:
        sec = sec_map.get(off.section_code)
        if off.combined_class_group:
            if sec:
                combined_group_students[off.combined_class_group] += sec.student_count
            combined_group_leader.setdefault(off.combined_class_group, off.code)

    def leader_of(off: OfferingModel) -> OfferingModel | None:
        if not off.combined_class_group:
            return None
        leader_code = combined_group_leader[off.combined_class_group]
        return None if leader_code == off.code else off_by_code[leader_code]

    # Pre-analyze qualified faculty and fitting rooms per offering
    qualified_fac_by_off: dict[str, list[str]] = {}
    fitting_rooms_by_off: dict[str, list[str]] = {}
    for off in problem.offerings:
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

        sec = sec_map.get(off.section_code)
        req_cap = sec.student_count if sec else 0
        if off.combined_class_group:
            req_cap = max(req_cap, combined_group_students[off.combined_class_group])
        fitting_rooms_by_off[off.code] = [
            r.code
            for r in room_map.values()
            if r.type == off.required_room_type and r.capacity >= req_cap
        ]

    horizon = len(WEEKDAY_ORDER) * DAY_MINUTES
    objective_terms: list[cp_model.LinearExpr | int] = []
    meetings: dict[tuple[str, int], _MeetingVars] = {}
    # Meetings with their own time choice (combined-class followers share their
    # leader's), for the SC-05 time-of-day spread.
    spread_meetings: list[_MeetingVars] = []
    fac_choice: dict[str, dict[str, cp_model.IntVar]] = {}
    fac_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    room_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    sec_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    fac_minute_terms: dict[str, list[cp_model.LinearExpr]] = defaultdict(list)
    fac_unit_terms: dict[str, list[cp_model.LinearExpr]] = defaultdict(list)

    def build_meeting(
        off: OfferingModel,
        m_idx: int,
        base_times: list[tuple[Weekday, int, int]],
        f_vars: dict[str, cp_model.IntVar],
    ) -> _MeetingVars:
        key = (off.code, m_idx)
        sched = model.new_bool_var(f"sched_{off.code}_{m_idx}")
        prior = prior_lookup.get(key)
        sec = sec_map.get(off.section_code)

        times = base_times
        rooms = fitting_rooms_by_off[off.code]
        facs = list(f_vars)
        if prior is not None and prior.pinned:
            times = [t for t in times if t[0] == prior.weekday and t[1] == prior.start_min]
            rooms = [r for r in rooms if r == prior.room_code]
            facs = [f for f in facs if f == prior.faculty_code]

        # Rooms that are never usable at any candidate time are dropped up front.
        room_ok = {r: [avail.room(r, off.code, d, s, e) for (d, s, e) in times] for r in rooms}
        rooms = [r for r in rooms if any(room_ok[r])]
        fac_ok = {f: [avail.faculty(f, d, s, e) for (d, s, e) in times] for f in facs}
        facs = [f for f in facs if any(fac_ok[f])]

        objective_terms.append(UNSCHEDULED_PENALTY * (1 - sched))
        if not times or not rooms or not facs:
            model.add(sched == 0)
            return _MeetingVars(off, m_idx, sched, [], [], {}, {}, None)

        t_vars = [model.new_bool_var(f"t_{off.code}_{m_idx}_{i}") for i in range(len(times))]
        y_vars = {r: model.new_bool_var(f"y_{off.code}_{m_idx}_{r}") for r in rooms}
        x_vars = {f: model.new_bool_var(f"x_{off.code}_{m_idx}_{f}") for f in facs}
        model.add_exactly_one([*t_vars, ~sched])
        model.add_exactly_one([*y_vars.values(), ~sched])
        model.add_exactly_one([*x_vars.values(), ~sched])
        for f, x in x_vars.items():
            # x == f_var AND sched  (faculty is per offering, so all meetings agree)
            model.add_implication(x, f_vars[f])
            model.add_bool_or([~f_vars[f], ~sched, x])

        start = model.new_int_var(0, horizon, f"start_{off.code}_{m_idx}")
        model.add(
            start
            == sum(_week_minute(d, s) * t for (d, s, _e), t in zip(times, t_vars, strict=True))
        )
        dur = off.minutes_per_meeting
        sec_intervals[off.section_code].append(
            model.new_optional_fixed_size_interval_var(start, dur, sched, f"sec_{off.code}_{m_idx}")
        )
        for f, x in x_vars.items():
            fac_intervals[f].append(
                model.new_optional_fixed_size_interval_var(
                    start, dur, x, f"fac_{off.code}_{m_idx}_{f}"
                )
            )
            fac_minute_terms[f].append(dur * x)
            bad = [t for t, ok in zip(t_vars, fac_ok[f], strict=True) if not ok]
            if bad:
                model.add(sum(bad) == 0).only_enforce_if(x)
        for r, y in y_vars.items():
            room_intervals[r].append(
                model.new_optional_fixed_size_interval_var(
                    start, dur, y, f"room_{off.code}_{m_idx}_{r}"
                )
            )
            bad = [t for t, ok in zip(t_vars, room_ok[r], strict=True) if not ok]
            if bad:
                model.add(sum(bad) == 0).only_enforce_if(y)
        for fac_code, room_code in avail.faculty_room_exclusions(off.code):
            if fac_code in x_vars and room_code in y_vars:
                model.add_bool_or([~x_vars[fac_code], ~y_vars[room_code]])

        # Separable soft penalties
        for (d, s, e), t in zip(times, t_vars, strict=True):
            pen = _time_penalty(problem, off, sec, d, s, e, prior)
            if pen:
                objective_terms.append(pen * t)
        for r, y in y_vars.items():
            pen = _room_penalty(problem, sec, room_map.get(r), prior)
            if pen:
                objective_terms.append(pen * y)
        for f, x in x_vars.items():
            pen = _faculty_penalty(problem, off, f, prior)
            if pen:
                objective_terms.append(pen * x)

        # SC-01 / SC-04: faculty preferences interact with time or room choice
        pref_terms: list[tuple[cp_model.IntVar, cp_model.IntVar, list[cp_model.IntVar]]] = []
        for f, x in x_vars.items():
            for pref in prefs_by_fac.get(f, []):
                if pref.type == "AVOID_DAY":
                    hits = [
                        t
                        for (d, _s, _e), t in zip(times, t_vars, strict=True)
                        if d.value == pref.value.upper()
                    ]
                    pen = round(w_sc01 * max(pref.weight, 1.0) * 10)
                elif pref.type == "PREFERRED_TIME":
                    val = pref.value.upper()
                    hits = [
                        t
                        for (_d, s, _e), t in zip(times, t_vars, strict=True)
                        if ("MORNING" in val and s >= 720) or ("AFTERNOON" in val and s < 720)
                    ]
                    pen = round(w_sc01 * 0.5 * 10)
                elif pref.type == "PREFERRED_ROOM":
                    hits = [y for r, y in y_vars.items() if r != pref.value]
                    pen = round(w_sc04 * 0.5 * 10)
                else:
                    continue
                if not hits or not pen:
                    continue
                z = model.new_bool_var(f"pref_{off.code}_{m_idx}_{f}_{pref.type}")
                model.add(z >= x + sum(hits) - 1)
                objective_terms.append(pen * z)
                pref_terms.append((z, x, hits))

        day_bools: dict[Weekday, list[cp_model.IntVar]] = defaultdict(list)
        for (d, _s, _e), t in zip(times, t_vars, strict=True):
            day_bools[d].append(t)
        day_expr = sum(
            WEEKDAY_ORDER.index(d) * t for (d, _s, _e), t in zip(times, t_vars, strict=True)
        )
        return _MeetingVars(
            off,
            m_idx,
            sched,
            times,
            t_vars,
            y_vars,
            x_vars,
            start,
            day_expr,
            dict(day_bools),
            pref_terms,
        )

    def build_follower_meeting(off: OfferingModel, m_idx: int, lead: _MeetingVars) -> _MeetingVars:
        """Combined-class follower: shares the leader's slot, room and faculty."""
        sched = model.new_bool_var(f"sched_{off.code}_{m_idx}")
        objective_terms.append(UNSCHEDULED_PENALTY * (1 - sched))
        if lead.start is None or off.minutes_per_meeting != lead.off.minutes_per_meeting:
            # A follower can only share the leader's slot if the durations match (HC-13).
            model.add(sched == 0)
            return _MeetingVars(off, m_idx, sched, [], [], {}, {}, None)
        model.add_implication(sched, lead.sched)
        follower_days = set(_allowed_weekdays_for_offering(problem, off))
        bad_t = [
            t
            for (d, s, e), t in zip(lead.times, lead.t_vars, strict=True)
            if d not in follower_days or not avail.section(off.section_code, d, s, e)
        ]
        if bad_t:
            model.add(sum(bad_t) == 0).only_enforce_if(sched)
        allowed_facs = set(qualified_fac_by_off[off.code])
        for f, x in lead.x_vars.items():
            if f not in allowed_facs:
                model.add_implication(sched, ~x)
        allowed_rooms = set(fitting_rooms_by_off[off.code])
        for r, y in lead.y_vars.items():
            if r not in allowed_rooms:
                model.add_implication(sched, ~y)
        sec_intervals[off.section_code].append(
            model.new_optional_fixed_size_interval_var(
                lead.start, lead.off.minutes_per_meeting, sched, f"sec_{off.code}_{m_idx}"
            )
        )
        return _MeetingVars(
            off,
            m_idx,
            sched,
            lead.times,
            lead.t_vars,
            lead.y_vars,
            lead.x_vars,
            lead.start,
            lead.day_expr,
            lead.day_bools,
        )

    # Leaders and independent offerings first so followers can reference them.
    ordered = sorted(problem.offerings, key=lambda o: leader_of(o) is not None)
    for off in ordered:
        leader = leader_of(off)
        shared = min(off.meetings_per_week, leader.meetings_per_week) if leader else 0
        own_meetings = range(shared, off.meetings_per_week)

        f_vars = {
            f: model.new_bool_var(f"fac_{off.code}_{f}") for f in qualified_fac_by_off[off.code]
        }
        fac_choice[off.code] = f_vars
        allowed_days = _allowed_weekdays_for_offering(problem, off)
        base_times = [
            (d, s, s + off.minutes_per_meeting)
            for d in allowed_days
            for s in _candidate_start_mins(problem, off.minutes_per_meeting)
            if avail.section(off.section_code, d, s, s + off.minutes_per_meeting)
        ]

        for m_idx in range(shared):
            assert leader is not None
            meetings[(off.code, m_idx)] = build_follower_meeting(
                off, m_idx, meetings[(leader.code, m_idx)]
            )
        own: list[_MeetingVars] = []
        for m_idx in own_meetings:
            mv = build_meeting(off, m_idx, base_times, f_vars)
            meetings[(off.code, m_idx)] = mv
            own.append(mv)
            spread_meetings.append(mv)

        # One faculty per offering, assigned exactly when any own meeting runs.
        if f_vars:
            model.add(sum(f_vars.values()) <= 1)
            model.add(sum(f_vars.values()) <= sum(mv.sched for mv in own))
            for mv in own:
                model.add(sum(f_vars.values()) >= mv.sched)
            units_tenths = round(units_of(off) * 10)
            for f, v in f_vars.items():
                fac_unit_terms[f].append(units_tenths * v)

        # HC-13: distinct, ordered weekdays across meetings of the same offering
        all_mv = [meetings[(off.code, m)] for m in range(off.meetings_per_week)]
        if len(all_mv) > 1 and leader is None:
            for day in allowed_days:
                same_day = [t for mv in all_mv for t in mv.day_bools.get(day, [])]
                if len(same_day) > 1:
                    model.add(sum(same_day) <= 1)
            for cur, nxt in pairwise(all_mv):
                if cur.start is not None and nxt.start is not None:
                    model.add(cur.day_expr + 1 <= nxt.day_expr).only_enforce_if(
                        [cur.sched, nxt.sched]
                    )

    # HC-01, HC-02, HC-03: NoOverlap per faculty, room, and section
    for ivs in (*fac_intervals.values(), *room_intervals.values(), *sec_intervals.values()):
        if len(ivs) > 1:
            model.add_no_overlap(ivs)

    # HC-07: Faculty max teaching load (minutes and tenths of a unit)
    for f_code, fac in fac_map.items():
        if fac_minute_terms.get(f_code):
            model.add(sum(fac_minute_terms[f_code]) <= round(fac.max_load_hours * 60))
        if fac_unit_terms.get(f_code):
            model.add(sum(fac_unit_terms[f_code]) <= round(fac.max_load_units * 10))

    # SC-05 (time of day): penalize classes beyond an even daytime spread that
    # run in the same period, so free slots are used instead of every class
    # starting at the first slot of the day.
    w_sc05 = weights.get(SoftConstraintCode.SC_05, 6.0)
    slot = max(15, problem.term.slot_step_minutes)
    peak_target = daytime_peak_target(
        problem.term, sum(mv.off.minutes_per_meeting for mv in spread_meetings)
    )
    slot_unit = round(w_sc05 * SPREAD_PENALTY_FACTOR * (slot / 60.0) * 10)
    covering: dict[tuple[Weekday, int], list[cp_model.IntVar]] = defaultdict(list)
    for mv in spread_meetings:
        for (day, start, end), t in zip(mv.times, mv.t_vars, strict=True):
            pos = start - (start - problem.term.day_start_min) % slot
            while pos < end:
                covering[(day, pos)].append(t)
                pos += slot
    if slot_unit > 0:
        for (day, slot_start), lits in covering.items():
            if len(lits) <= peak_target:
                continue
            excess = model.new_int_var(
                0, len(lits) - peak_target, f"peak_{day.value}_{slot_start}"
            )
            model.add(excess >= sum(lits) - peak_target)
            objective_terms.append(slot_unit * excess)

    hints = _add_greedy_hints(
        model, problem, ordered, meetings, fac_choice, fac_map, units_of, prior_lookup, avail
    )

    model.minimize(sum(objective_terms))

    cfg = get_settings()
    solver = cp_model.CpSolver()
    elapsed_build = time.perf_counter() - t0
    limit_sec = (
        time_limit_seconds if time_limit_seconds is not None else cfg.solver_time_limit_seconds
    )
    # The time limit covers model building too, so the caller's budget is honored.
    solver.parameters.max_time_in_seconds = max(1.0, float(limit_sec) - elapsed_build)
    solver.parameters.num_workers = cfg.solver_workers
    # Presolve probing scales badly with the many optional intervals of a full term
    # (it consumed the whole budget at ~300 meetings); search works better without it.
    solver.parameters.cp_model_probing_level = 0

    raw_status = solver.solve(model)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    solved = raw_status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    hint_values = {idx: value for idx, (_var, value) in hints.items()}
    # If CP-SAT stops without any solution (e.g. time limit hit during presolve), fall
    # back to the greedy first-fit schedule, which already satisfies every hard rule.
    use_greedy = not solved and any(hint_values.get(mv.sched.index) for mv in meetings.values())

    def on(var: cp_model.IntVar) -> bool:
        return solver.boolean_value(var) if solved else bool(hint_values.get(var.index, 0))

    if not solved and not use_greedy:
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
    for off in problem.offerings:
        for m_idx in range(off.meetings_per_week):
            mv = meetings[(off.code, m_idx)]
            if mv.start is None or not on(mv.sched):
                continue
            day, s_min, e_min = next(tm for tm, t in zip(mv.times, mv.t_vars, strict=True) if on(t))
            room_code = next(r for r, y in mv.y_vars.items() if on(y))
            fac_code = next(f for f, x in mv.x_vars.items() if on(x))
            prior_item = prior_lookup.get((off.code, m_idx))
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
            lead = leader_of(off)
            if lead is None or m_idx >= min(off.meetings_per_week, lead.meetings_per_week):
                scheduled_hours_by_fac[fac_code] += (e_min - s_min) / 60.0
    for off in problem.offerings:
        for f, v in fac_choice.get(off.code, {}).items():
            if on(v):
                scheduled_units_by_fac[f] += units_of(off)

    unscheduled: list[UnscheduledMeetingResult] = []
    for off in problem.offerings:
        for m_idx in range(off.meetings_per_week):
            mv = meetings[(off.code, m_idx)]
            if mv.start is not None and on(mv.sched):
                continue
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

    obj_val = float(solver.objective_value) if solved else 0.0
    bound_val = float(solver.best_objective_bound) if solved else 0.0
    if not solved:
        gap_pct = 100.0  # greedy fallback: optimality unknown
    elif raw_status == cp_model.OPTIMAL or abs(obj_val) < 1e-6:
        gap_pct = 0.0
    else:
        gap_pct = round(max(0.0, (obj_val - bound_val) / max(1.0, abs(obj_val)) * 100.0), 2)
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


def _add_greedy_hints(
    model: cp_model.CpModel,
    problem: Problem,
    ordered: list[OfferingModel],
    meetings: dict[tuple[str, int], _MeetingVars],
    fac_choice: dict[str, dict[str, cp_model.IntVar]],
    fac_map: dict[str, FacultyModel],
    units_of: Callable[[OfferingModel], float],
    prior_lookup: dict[tuple[str, int], ScheduledMeetingEntry],
    avail: _AvailabilityIndex,
) -> dict[int, tuple[cp_model.IntVar, int]]:
    """Seed CP-SAT with a fast first-fit schedule so it starts from a full solution.

    Without a hint the empty schedule is the first feasible point the search finds,
    and on larger terms it can run out of time before placing most meetings.
    Hints never constrain the model; CP-SAT repairs or discards them freely.
    """
    state = _GreedyState()
    hints: dict[int, tuple[cp_model.IntVar, int]] = {}

    def own_meetings(off: OfferingModel) -> list[_MeetingVars]:
        return [
            mv
            for m in range(off.meetings_per_week)
            if (mv := meetings[(off.code, m)]).start is not None
            and mv.x_vars
            and fac_choice.get(off.code)
            and all(f in fac_choice[off.code] for f in mv.x_vars)
        ]

    def flexibility(off: OfferingModel) -> tuple[int, int]:
        mvs = own_meetings(off)
        pinned = any(
            (p := prior_lookup.get((off.code, mv.m_idx))) is not None and p.pinned for mv in mvs
        )
        size = min((len(mv.times) * len(mv.x_vars) * len(mv.y_vars) for mv in mvs), default=0)
        return (0 if pinned else 1, size)

    def try_place(
        off: OfferingModel, fac_code: str, mvs: list[_MeetingVars]
    ) -> list[tuple[_MeetingVars, int, str]]:
        fac = fac_map.get(fac_code)
        if fac is None:
            return []
        minutes_cap = round(fac.max_load_hours * 60) - state.fac_minutes[fac_code]
        if state.fac_units[fac_code] + units_of(off) > fac.max_load_units + 1e-6:
            return []
        placed: list[tuple[_MeetingVars, int, str]] = []
        used_days: set[Weekday] = set()
        last_day_idx = -1
        exclusions = set(avail.faculty_room_exclusions(off.code))
        for mv in mvs:
            if minutes_cap < off.minutes_per_meeting:
                break
            prior = prior_lookup.get((off.code, mv.m_idx))
            order = list(range(len(mv.times)))
            if prior is not None:
                order.sort(
                    key=lambda i: (
                        mv.times[i][0] != prior.weekday or mv.times[i][1] != prior.start_min
                    )
                )
            choice: tuple[int, str] | None = None
            for i in order:
                day, s_min, e_min = mv.times[i]
                d_idx = WEEKDAY_ORDER.index(day)
                if day in used_days or d_idx <= last_day_idx:
                    continue
                if not avail.faculty(fac_code, day, s_min, e_min):
                    continue
                if not _free(state.fac_busy[(fac_code, day)], s_min, e_min):
                    continue
                if not _free(state.sec_busy[(off.section_code, day)], s_min, e_min):
                    continue
                for room_code in mv.y_vars:
                    if (fac_code, room_code) in exclusions:
                        continue
                    if not avail.room(room_code, off.code, day, s_min, e_min):
                        continue
                    if _free(state.room_busy[(room_code, day)], s_min, e_min):
                        choice = (i, room_code)
                        break
                if choice:
                    break
            if choice is None:
                continue
            i, room_code = choice
            day, s_min, e_min = mv.times[i]
            placed.append((mv, i, room_code))
            used_days.add(day)
            last_day_idx = WEEKDAY_ORDER.index(day)
            minutes_cap -= off.minutes_per_meeting
            # Tentatively book so later meetings of this offering see it.
            state.fac_busy[(fac_code, day)].append((s_min, e_min))
            state.sec_busy[(off.section_code, day)].append((s_min, e_min))
            state.room_busy[(room_code, day)].append((s_min, e_min))
        for mv, i, room_code in placed:  # roll back the tentative bookings
            day, s_min, e_min = mv.times[i]
            state.fac_busy[(fac_code, day)].remove((s_min, e_min))
            state.sec_busy[(off.section_code, day)].remove((s_min, e_min))
            state.room_busy[(room_code, day)].remove((s_min, e_min))
        return placed

    for off in sorted((o for o in ordered if own_meetings(o)), key=flexibility):
        mvs = own_meetings(off)
        f_vars = fac_choice[off.code]
        prior_fac = next(
            (p.faculty_code for mv in mvs if (p := prior_lookup.get((off.code, mv.m_idx)))),
            None,
        )
        candidates = sorted(
            f_vars,
            key=lambda f: (
                f != prior_fac,
                state.fac_minutes[f] / max(1.0, fac_map[f].max_load_hours * 60)
                if f in fac_map
                else 1.0,
            ),
        )
        best: tuple[str, list[tuple[_MeetingVars, int, str]]] | None = None
        for fac_code in candidates:
            placed = try_place(off, fac_code, mvs)
            if best is None or len(placed) > len(best[1]):
                best = (fac_code, placed)
            if len(placed) == len(mvs):
                break
        if best is None or not best[1]:
            continue

        fac_code, placed = best
        state.fac_units[fac_code] += units_of(off)
        for f, v in f_vars.items():
            hints[v.index] = (v, 1 if f == fac_code else 0)
        placed_by_mv = {id(mv): (i, room_code) for mv, i, room_code in placed}
        for mv in mvs:
            pick = placed_by_mv.get(id(mv))
            hints[mv.sched.index] = (mv.sched, 1 if pick else 0)
            for f, x in mv.x_vars.items():
                hints[x.index] = (x, 1 if pick and f == fac_code else 0)
            for idx, t in enumerate(mv.t_vars):
                hints[t.index] = (t, 1 if pick and idx == pick[0] else 0)
            for r, y in mv.y_vars.items():
                hints[y.index] = (y, 1 if pick and r == pick[1] else 0)
            if pick:
                day, s_min, e_min = mv.times[pick[0]]
                assert mv.start is not None
                hints[mv.start.index] = (mv.start, _week_minute(day, s_min))
                state.fac_busy[(fac_code, day)].append((s_min, e_min))
                state.sec_busy[(off.section_code, day)].append((s_min, e_min))
                state.room_busy[(pick[1], day)].append((s_min, e_min))
                state.fac_minutes[fac_code] += off.minutes_per_meeting

    # Complete the hint: CP-SAT discards hints it cannot complete, so every model
    # variable gets a value. Anything not placed above defaults to "unscheduled".
    def value_of(var: cp_model.IntVar) -> int:
        return hints[var.index][1] if var.index in hints else 0

    for f_vars in fac_choice.values():
        for v in f_vars.values():
            hints.setdefault(v.index, (v, 0))
    for mv in meetings.values():
        hints.setdefault(mv.sched.index, (mv.sched, 0))
        for var in (*mv.t_vars, *mv.x_vars.values(), *mv.y_vars.values()):
            hints.setdefault(var.index, (var, 0))
        if mv.start is not None:
            hints.setdefault(mv.start.index, (mv.start, 0))
    for mv in meetings.values():
        for z, x, hits in mv.pref_terms:
            hints[z.index] = (z, 1 if value_of(x) and any(value_of(h) for h in hits) else 0)
    for var, value in hints.values():
        model.add_hint(var, value)
    return hints


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
        if not (e.offering_code == req.offering_code and e.meeting_index == req.meeting_index)
    ]
    current_target = next(
        (
            e
            for e in req.current_entries
            if e.offering_code == req.offering_code and e.meeting_index == req.meeting_index
        ),
        None,
    )

    sec_map = {s.code: s for s in problem.sections}
    sec = sec_map.get(off.section_code)
    req_cap = sec.student_count if sec else 0

    cand_rooms = [
        r.code
        for r in problem.rooms
        if r.status == "ACTIVE" and r.type == off.required_room_type and r.capacity >= req_cap
    ]
    qual_facs = [
        q.faculty_code for q in problem.qualifications if q.subject_code == off.subject_code
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
                        v for v in trial_res.violations if not v.waived and v.code.value != "HC-08"
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
