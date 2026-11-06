"""SC-05 time-of-day spread: shared definition of an even daytime spread.

Used by both the validator (scoring) and the solver (objective), so the two
agree on when classes are concentrated in the same period.
"""

import math

from engine.domain.models import TermConfig

# Classes are meant to fit the daytime window; SC-09/SC-10/SC-11 already
# discourage later slots, so the even spread is measured up to 5:30 PM.
DAYTIME_END_MIN = 1050
# Penalty per excess concurrent class-hour, as a fraction of the SC-05 weight.
SPREAD_PENALTY_FACTOR = 0.1


def daytime_peak_target(term: TermConfig, total_class_minutes: int) -> int:
    """How many classes may run at once before the schedule counts as clustered.

    It is the average number of concurrent classes if every class-minute of the
    week were spread evenly over the daytime window of every teaching day,
    rounded up (at least 1).
    """
    days = max(1, len(term.allowed_weekdays))
    daytime_end = min(term.day_end_min, DAYTIME_END_MIN)
    window = max(term.slot_step_minutes, daytime_end - term.day_start_min)
    return max(1, math.ceil(total_class_minutes / (days * window)))
