# Tapos-na

A week-scoped pomodoro planner. The app works on a single week at a time:
recurring templates, one-off items, and todos all live inside one fixed
Monday–Sunday week that is scheduled, rendered, and stored in a single shape.

## Language

**Week**:
The fundamental scheduling period. Always Monday–Sunday, anchored to the
Monday of the current week in the user's timezone. Storage, scheduling, and
the timer all assume this order — there is no setting for where it starts.
_Avoid_: "Sunday-first week", "week starting Sunday"

**Week day**:
One of the seven days of the Week, in fixed storage order (Monday first).
Used as the discriminator across items, todos, templates, and the per-day
schedule.
_Avoid_: weekday (unqualified), "day of week"

**Week-day occupancy**:
The time occupied on one Week day by its recurring template, one-off items,
and sleep windows. A sleep override replaces the recurring template sleep for
that Week day, while one-off sleep remains additive. The unoccupied time is
available for scheduling todos.
