# Carry sleep occupancy across the Monday boundary

Cross-midnight sleep that begins on Sunday must block the following Monday,
even though each `CalendarDoc` stores only one Monday–Sunday Week. We therefore
persist the Week identity and derive read-only Week-boundary occupancy on the
new Monday: recurring template sleep carries across every Week, while one-off
sleep carries only when the prior document is exactly the immediately
preceding Week. This keeps the week-scoped storage model while preventing the
next Monday from scheduling work during a sleep window; the boundary occupancy
cannot be edited from the current Week.

**Status**: accepted
