/**
 * Schema seam tests (T1): every item type + settings + template +
 * `CalendarDoc` encode/decode round-trips as identity, and corrupt input
 * fails decode with a typed `ParseError` — never silent garbage.
 */
import { describe, expect, it } from "vitest";
import { ParseResult, Schema } from "effect";
import {
  Busy,
  CalendarDoc,
  DayTemplate,
  Event,
  Settings,
  Sleep,
  TemplateBusy,
  Todo,
  WEEKDAY_NAMES,
  decodeCalendarDoc,
  decodeCalendarDocSync,
  encodeCalendarDoc,
  type DayItem,
} from "./schema";

/** Assert that decode → encode reproduces the input exactly (identity). */
const expectRoundTrip =
  <S extends Schema.Schema.AnyNoContext>(schema: S) =>
  (input: Schema.Schema.Encoded<S>) => {
    const decoded = Schema.decodeUnknownSync(schema)(input as unknown);
    expect(Schema.encodeSync(schema)(decoded)).toEqual(input);
  };

/** Assert that decoding `input` throws a typed `ParseError`. */
const expectParseError = (decode: () => unknown) => {
  let error: unknown;
  try {
    decode();
  } catch (caught) {
    error = caught;
  }
  expect(
    ParseResult.isParseError(error),
    `expected a ParseError, got: ${String(error)}`,
  ).toBe(true);
};

const busy = {
  _tag: "busy",
  id: "b1",
  title: "Algebra",
  day: "monday",
  start: 480,
  end: 600,
} as const;
const event = {
  _tag: "event",
  id: "e1",
  title: "Dentist",
  day: "wednesday",
  start: 900,
  end: 960,
} as const;
const sleep = {
  _tag: "sleep",
  id: "s1",
  day: "tuesday",
  start: 60,
  end: 90,
} as const;
const todoWithDue = {
  _tag: "todo",
  id: "t1",
  title: "Essay",
  pomodoros: 6,
  dueDate: "friday",
  priority: "P0",
} as const;
const todoNoDue = {
  _tag: "todo",
  id: "t2",
  title: "Lab report",
  pomodoros: 3,
  priority: "P2",
} as const;

const template = {
  busy: [{ id: "tb1", title: "Math", start: 480, end: 600 }],
  sleep: [{ id: "ts1", start: 1380, end: 420 }], // 23:00 → 07:00, crosses midnight
} as const;

const settings = {
  workLength: 25,
  breakLength: 5,
  longBreakLength: 30,
  miniFocus: true,
  timezone: "Asia/Manila",
} as const;

const emptyDay = { template: { busy: [], sleep: [] }, items: [] } as const;

const sampleDoc = {
  version: 1,
  weekIdentity: "2026-08-17",
  boundaryOccupancy: [],
  settings: { ...settings, apiKey: "k-secret" },
  days: {
    monday: {
      template,
      items: [event],
      sleepOverride: [{ start: 1380, end: 480 }],
    },
    tuesday: { template: { busy: [], sleep: [] }, items: [busy, sleep] },
    wednesday: emptyDay,
    thursday: emptyDay,
    friday: emptyDay,
    saturday: emptyDay,
    sunday: emptyDay,
  },
  todos: [todoWithDue, todoNoDue],
} as const;

describe("item round-trips (identity)", () => {
  it("busy", () => {
    expectRoundTrip(Busy)(busy);
  });

  it("event", () => {
    expectRoundTrip(Event)(event);
  });

  it("sleep", () => {
    expectRoundTrip(Sleep)(sleep);
  });

  it("sleep: a night window may cross midnight", () => {
    expectRoundTrip(Sleep)({ ...sleep, start: 1320, end: 60 }); // 22:00 → 01:00
  });

  it("todo with due date", () => {
    expectRoundTrip(Todo)(todoWithDue);
  });

  it("todo without due date", () => {
    expectRoundTrip(Todo)(todoNoDue);
  });

  it("every todo priority round-trips", () => {
    for (const priority of ["P0", "P1", "P2", "P3", "P4"] as const) {
      expectRoundTrip(Todo)({ ...todoWithDue, priority });
    }
  });

  it("every day of week round-trips on a busy block", () => {
    for (const day of WEEKDAY_NAMES) {
      expectRoundTrip(Busy)({ ...busy, day });
    }
  });
});

describe("day template + settings round-trips (identity)", () => {
  it("day template (incl. cross-midnight sleep)", () => {
    expectRoundTrip(DayTemplate)(template);
  });

  it("settings (defaults shape)", () => {
    expectRoundTrip(Settings)(settings);
  });

  it("settings with apiKey", () => {
    expectRoundTrip(Settings)({ ...settings, apiKey: "k-secret" });
  });
});

describe("CalendarDoc round-trip (identity)", () => {
  it("full doc with items, template, override, todos, settings", () => {
    expectRoundTrip(CalendarDoc)(sampleDoc);
  });

  it("encode(decode(x)) === x for a doc without optional fields", () => {
    const minimal = {
      version: 1,
      weekIdentity: "2026-08-17",
      boundaryOccupancy: [],
      settings,
      days: {
        monday: emptyDay,
        tuesday: emptyDay,
        wednesday: emptyDay,
        thursday: emptyDay,
        friday: emptyDay,
        saturday: emptyDay,
        sunday: emptyDay,
      },
      todos: [],
    } as const;
    expectRoundTrip(CalendarDoc)(minimal);
  });

  it("the exported codecs round-trip a parsed JSON string", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(sampleDoc));
    const doc = decodeCalendarDocSync(parsed);
    expect(encodeCalendarDoc(doc)).toEqual(sampleDoc);
  });
});

describe("corrupt input fails decode with a typed error", () => {
  it("busy: zero-length span", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, end: 480 }),
    );
  });

  it("busy: inverted span (end before start) is rejected", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, end: 300 }),
    );
  });

  it("event: inverted span (end before start) is rejected", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Event)({ ...event, end: 300 }),
    );
  });

  it("busy: unknown day", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, day: "funday" }),
    );
  });

  it("busy: non-integer time", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, start: 480.5 }),
    );
  });

  it("busy: time out of range", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, end: 1441 }),
    );
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, start: -1 }),
    );
  });

  it("busy: empty title", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Busy)({ ...busy, title: "" }),
    );
  });

  it("busy: missing required field", () => {
    const { id: _id, ...rest } = busy;
    expectParseError(() => Schema.decodeUnknownSync(Busy)(rest));
  });

  it("event: zero-length span", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Event)({ ...event, start: 900, end: 900 }),
    );
  });

  it("sleep: zero-length span", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Sleep)({ ...sleep, start: 60, end: 60 }),
    );
  });

  it("todo: zero pomodoros", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Todo)({ ...todoWithDue, pomodoros: 0 }),
    );
  });

  it("todo: fractional pomodoros", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Todo)({ ...todoWithDue, pomodoros: 1.5 }),
    );
  });

  it("todo: unknown priority", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Todo)({ ...todoWithDue, priority: "P9" }),
    );
  });

  it("todo: empty title", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Todo)({ ...todoWithDue, title: "" }),
    );
  });

  it("day items: unknown _tag is rejected", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Schema.Array(Schema.Union(Busy, Event, Sleep)))([
        { ...event, _tag: "party" },
      ]),
    );
  });

  it("template busy: inverted span (end before start) is rejected", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(TemplateBusy)({
        id: "tb1",
        title: "Class",
        start: 600,
        end: 480,
      }),
    );
  });

  it("template busy: zero-length span", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(TemplateBusy)({
        id: "tb1",
        title: "Class",
        start: 480,
        end: 480,
      }),
    );
  });

  it("settings: work length not on a 5-minute step", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Settings)({ ...settings, workLength: 7 }),
    );
  });

  it("settings: work length out of range", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Settings)({ ...settings, workLength: 0 }),
    );
  });

  it("settings: long break not on a 30-minute step", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Settings)({ ...settings, longBreakLength: 15 }),
    );
  });

  it("settings: invalid timezone", () => {
    expectParseError(() =>
      Schema.decodeUnknownSync(Settings)({
        ...settings,
        timezone: "Mars/Olympus",
      }),
    );
  });

  it("settings: legacy weekStart key is rejected (week is always Monday-anchored)", () => {
    expectParseError(() =>
      decodeCalendarDocSync({
        ...sampleDoc,
        settings: { ...settings, weekStart: "monday" },
      }),
    );
  });

  it("doc: unsupported version", () => {
    expectParseError(() => decodeCalendarDocSync({ ...sampleDoc, version: 2 }));
  });

  it("doc: missing a day", () => {
    const { sunday: _sunday, ...days } = sampleDoc.days;
    expectParseError(() => decodeCalendarDocSync({ ...sampleDoc, days }));
  });

  it("doc: unknown key is rejected (never silent garbage)", () => {
    expectParseError(() =>
      decodeCalendarDocSync({ ...sampleDoc, hack: "nope" }),
    );
    expectParseError(() =>
      decodeCalendarDocSync({
        ...sampleDoc,
        days: {
          ...sampleDoc.days,
          monday: { ...sampleDoc.days.monday, junk: 1 },
        },
      }),
    );
  });

  it("doc: corrupt item inside a day", () => {
    expectParseError(() =>
      decodeCalendarDocSync({
        ...sampleDoc,
        days: {
          ...sampleDoc.days,
          tuesday: {
            ...sampleDoc.days.tuesday,
            items: [busy, { ...sleep, end: 90, start: 90 }],
          },
        },
      }),
    );
  });

  it("doc: corrupt settings inside the doc", () => {
    expectParseError(() =>
      decodeCalendarDocSync({
        ...sampleDoc,
        settings: { ...settings, timezone: "Nowhere/Else" },
      }),
    );
  });

  it("doc: corrupt todo inside the doc", () => {
    expectParseError(() =>
      decodeCalendarDocSync({
        ...sampleDoc,
        todos: [{ ...todoNoDue, pomodoros: 0 }],
      }),
    );
  });

  it("doc: null where an object is required", () => {
    expectParseError(() =>
      decodeCalendarDocSync({ ...sampleDoc, settings: null }),
    );
  });

  it("decodeCalendarDoc returns Left(ParseError) instead of throwing", () => {
    const result = decodeCalendarDoc({ ...sampleDoc, version: 99 });
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(ParseResult.isParseError(result.left)).toBe(true);
    }
  });
});

describe("schema shapes", () => {
  it("WEEKDAY_NAMES covers the week in storage order", () => {
    expect(WEEKDAY_NAMES).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });

  it("day items are one of busy | event | sleep", () => {
    // Type-level check: a day's items never include todos.
    const items: DayItem[] = [
      { _tag: "busy", id: "b", title: "T", day: "monday", start: 0, end: 60 },
      { _tag: "event", id: "e", title: "T", day: "monday", start: 0, end: 60 },
      { _tag: "sleep", id: "s", day: "monday", start: 0, end: 60 },
    ];
    expect(items.map((i) => i._tag)).toEqual(["busy", "event", "sleep"]);
  });
});
