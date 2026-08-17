# The week is Monday-anchored — no week-start setting

A Sunday-first display setting coexisted with a Monday-anchored week model,
but it only reordered columns: storage, the scheduling engine, and the timer
all stayed Monday-first, so the Sunday-first view hid a column of real data
behind a placeholder and the timer still reset the week on Monday. We removed
the setting and its `weekStart` schema field — the week is always
Monday–Sunday, and a future reader who misses the option should not re-add it
without re-anchoring the whole model. No migration: the only user discarded
the stored doc, so `CalendarDoc.version` stays 1 and any doc that doesn't
match the current shape fails strict decode as corrupt.

Status: accepted

Considered options:
- Keep Sunday-first but make it honest by re-anchoring the week — rejected:
  the doc *is* a Monday-anchored week; re-anchoring rewrites storage,
  scheduling, and timezone anchoring for a display preference.
- Remove the toggle but keep the schema field — rejected: dead field.
