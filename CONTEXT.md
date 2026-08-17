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

**Day item**:
A one-off, time-pinned item assigned to one Week day: a busy block, event, or
sleep window. Day items occupy wall-clock time and can be moved or resized;
recurring template blocks and derived pomodoro segments are not day items.
_Avoid_: calendar block when referring to the stored domain entity, scheduled
task

**Wall-clock span**:
The start and end time of a day item expressed as local minutes from midnight.
Moving a day item between Week days preserves its wall-clock span rather than
its elapsed UTC duration.

**Week identity**:
The local calendar date of the Monday that anchors a Week. It identifies which
Monday–Sunday period a CalendarDoc represents; it is not a user-configurable
week-start preference.

**Week-boundary occupancy**:
Read-only occupancy carried into Monday from a cross-midnight sleep that began
on the preceding Sunday. Recurring template sleep carries across every Week;
one-off sleep carries only from the immediately preceding Week. It blocks
scheduling and collisions in the current Week but cannot be edited from that
Week.
