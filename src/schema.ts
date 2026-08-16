/**
 * Domain schema — the single source of truth for every stored type and the
 * week-only `CalendarDoc` (Monday–Sunday, UTC + timezone), defined with
 * Effect Schema.
 *
 * This is the storage seam: everything that persists (localStorage now, R2
 * later) is encoded/decoded through these schemas. `encode`/`decode` are
 * inverses — every type round-trips as identity — and corrupt input fails
 * with a typed `ParseError`, never silent garbage.
 *
 * Vocabulary follows the spec (T1): busy blocks, events, todos (pomodoro
 * count, optional due date, P0–P4 priority), sleep windows, the per-day
 * weekly template, settings, and the full `CalendarDoc`.
 */
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Week days, Monday-first — the storage order of the week. */
export const WEEKDAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** Day-of-week discriminator used across items, todos, and templates. */
export const DayOfWeek = Schema.Literal(...WEEKDAY_NAMES);
export type DayOfWeek = typeof DayOfWeek.Type;

/** Short 3-letter labels for day-of-week display. */
export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/**
 * Minutes since local midnight, 0..1440 (1440 = the end of the day).
 * Times are wall-clock; the stored IANA timezone + DST-aware rendering map
 * them to real instants at use time.
 */
export const DayTime = Schema.Int.pipe(Schema.between(0, 1440));
export type DayTime = typeof DayTime.Type;

/** P0 = critical … P4 = lowest priority. */
export const Priority = Schema.Literal("P0", "P1", "P2", "P3", "P4");
export type Priority = typeof Priority.Type;

/**
 * IANA timezone identifier (e.g. `Asia/Manila`, `UTC`). Validated against
 * `Intl` so a typo'd zone fails decode instead of silently shifting times.
 */
export const Timezone = Schema.String.pipe(
  Schema.filter(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    {
      message: () =>
        'must be a valid IANA timezone identifier (e.g. "Asia/Manila")',
    },
  ),
);
export type Timezone = typeof Timezone.Type;

/**
 * Reject zero-length spans. Written as a pipe-based helper (not a prebuilt
 * `Schema.filter(...)` const) so TypeScript infers the input schema from the
 * pipe target; the call-form `Schema.filter(...)(self)` loses the inference
 * and poisons every derived schema with `Context = unknown`.
 */
const nonZeroSpan = <S extends Schema.Schema.AnyNoContext>(self: S) =>
  self.pipe(
    Schema.filter((s) => s.end !== s.start, {
      message: () => "end must differ from start",
    }),
  );

/**
 * Reject zero-length and inverted spans. Day-pinned busy blocks and events
 * never wrap midnight (unlike sleep windows), so an `end` before `start` is
 * corruption — never silently accepted.
 */
const forwardSpan = <S extends Schema.Schema.AnyNoContext>(self: S) =>
  self.pipe(
    Schema.filter((s) => s.end > s.start, {
      message: () => "end must be after start",
    }),
  );

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Fixed commitment (class, work shift) pinned to one day. */
export const Busy = Schema.Struct({
  _tag: Schema.Literal("busy"),
  id: Schema.String,
  title: Schema.NonEmptyString,
  day: DayOfWeek,
  start: DayTime,
  end: DayTime,
}).pipe(forwardSpan);
export type Busy = typeof Busy.Type;

/** One-off appointment — the schedule always yields to events. */
export const Event = Schema.Struct({
  _tag: Schema.Literal("event"),
  id: Schema.String,
  title: Schema.NonEmptyString,
  day: DayOfWeek,
  start: DayTime,
  end: DayTime,
}).pipe(forwardSpan);
export type Event = typeof Event.Type;

/** One-off sleep window (nap, or a one-off night adjustment). */
export const Sleep = Schema.Struct({
  _tag: Schema.Literal("sleep"),
  id: Schema.String,
  day: DayOfWeek,
  start: DayTime,
  end: DayTime,
}).pipe(nonZeroSpan);
export type Sleep = typeof Sleep.Type;

/**
 * Work item. Never pinned to a day — the engine sizes (pomodoro count),
 * orders (priority), and places it in free gaps, bounded by `dueDate`.
 */
export const Todo = Schema.Struct({
  _tag: Schema.Literal("todo"),
  id: Schema.String,
  title: Schema.NonEmptyString,
  pomodoros: Schema.Int.pipe(Schema.greaterThan(0)),
  dueDate: Schema.optional(DayOfWeek),
  priority: Priority,
});
export type Todo = typeof Todo.Type;

/** One-off, day-pinned items. Todos are week-scoped and live on the doc. */
export const DayItem = Schema.Union(Busy, Event, Sleep);
export type DayItem = typeof DayItem.Type;

/** Every item kind, for UI/state convenience. */
export const Item = Schema.Union(Busy, Event, Todo, Sleep);
export type Item = typeof Item.Type;

// ---------------------------------------------------------------------------
// Weekly template (per day) & sleep override
// ---------------------------------------------------------------------------

/** Recurring busy block inside a day's template. */
export const TemplateBusy = Schema.Struct({
  id: Schema.String,
  title: Schema.NonEmptyString,
  start: DayTime,
  end: DayTime,
}).pipe(forwardSpan);
export type TemplateBusy = typeof TemplateBusy.Type;

/** Recurring sleep window inside a day's template. May cross midnight. */
export const TemplateSleep = Schema.Struct({
  id: Schema.String,
  start: DayTime,
  end: DayTime,
}).pipe(nonZeroSpan);
export type TemplateSleep = typeof TemplateSleep.Type;

/** Sleep window without identity (used for one-off overrides). */
export const SleepBlock = Schema.Struct({
  start: DayTime,
  end: DayTime,
}).pipe(nonZeroSpan);
export type SleepBlock = typeof SleepBlock.Type;

/** A day's recurring commitments: busy blocks and sleep windows. */
export const DayTemplate = Schema.Struct({
  busy: Schema.Array(TemplateBusy),
  sleep: Schema.Array(TemplateSleep),
});
export type DayTemplate = typeof DayTemplate.Type;

// ---------------------------------------------------------------------------
// Day, settings, doc
// ---------------------------------------------------------------------------

/**
 * One day of the week: the recurring template, one-off items, and an
 * optional sleep override (when present, it replaces the template's sleep
 * windows for that day — a late night out or early start without touching
 * the template).
 */
export const Day = Schema.Struct({
  template: DayTemplate,
  items: Schema.Array(DayItem),
  sleepOverride: Schema.optional(Schema.Array(SleepBlock)),
});
export type Day = typeof Day.Type;

/**
 * User preferences. Work/break lengths step by 5 minutes; the long break
 * steps by 30 (cadence is fixed at every 4th pomodoro). Bounds (5–90 and
 * 30–120) are product sanity ranges — the spec fixes only the step sizes.
 */
export const Settings = Schema.Struct({
  weekStart: Schema.Literal("monday", "sunday"),
  workLength: Schema.Int.pipe(Schema.multipleOf(5), Schema.between(5, 90)),
  breakLength: Schema.Int.pipe(Schema.multipleOf(5), Schema.between(5, 90)),
  longBreakLength: Schema.Int.pipe(
    Schema.multipleOf(30),
    Schema.between(30, 120),
  ),
  miniFocus: Schema.Boolean,
  timezone: Timezone,
  // TODO(r2): phase-2 R2 API key. Stored with the doc in localStorage today;
  // the key must not be written to exported docs.
  apiKey: Schema.optional(Schema.String),
});
export type Settings = typeof Settings.Type;

/** Monday–Sunday, in storage order. */
export const WeekDays = Schema.Struct({
  monday: Day,
  tuesday: Day,
  wednesday: Day,
  thursday: Day,
  friday: Day,
  saturday: Day,
  sunday: Day,
});
export type WeekDays = typeof WeekDays.Type;

/**
 * The single JSON document: exactly Monday–Sunday of the current week
 * (no history), stored in UTC + timezone, plus settings and week-scoped
 * todos. Pomodoros are never stored — they are derived from these inputs.
 */
export const CalendarDoc = Schema.Struct({
  version: Schema.Literal(1),
  settings: Settings,
  days: WeekDays,
  todos: Schema.Array(Todo),
});
export type CalendarDoc = typeof CalendarDoc.Type;

// ---------------------------------------------------------------------------
// Codecs (the schema seam)
// ---------------------------------------------------------------------------

/** Reject unknown keys anywhere in the tree — corrupt docs fail loudly. */
const STRICT = { onExcessProperty: "error" } as const;

/**
 * Decode a `CalendarDoc` from unknown input (e.g. parsed JSON).
 * Returns `Left` with a typed `ParseError` on corrupt input.
 */
export const decodeCalendarDoc = Schema.decodeUnknownEither(
  CalendarDoc,
  STRICT,
);

/** Decode a `CalendarDoc`, throwing a `ParseError` on corrupt input. */
export const decodeCalendarDocSync = Schema.decodeUnknownSync(
  CalendarDoc,
  STRICT,
);

/** Encode a `CalendarDoc` back to its JSON shape. */
export const encodeCalendarDoc = Schema.encodeSync(CalendarDoc);
