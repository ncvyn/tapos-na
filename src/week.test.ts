import { describe, expect, it } from "vitest";
import { computeSchedule } from "./engine";
import { getWeekDayOccupancy } from "./occupancy";
import { wouldCollide } from "./collision";
import {
  createDefaultDoc,
  makeMemoryStorageLayer,
  rolloverCalendarDoc,
  StorageService,
} from "./storage";
import { getWeekIdentity } from "./time";
import type { CalendarDoc } from "./schema";
import { decodeCalendarDoc, type BoundaryOccupancy } from "./schema";
import { Effect } from "effect";

const MONDAY = "2026-08-17";
const NEXT_MONDAY = "2026-08-24";
const SKIPPED_MONDAY = "2026-08-31";

function docAt(weekStart = "2026-08-10"): CalendarDoc {
  const doc = createDefaultDoc("UTC", Date.parse("2026-08-10T12:00:00Z"));
  return { ...doc, weekStart: weekStart as CalendarDoc["weekStart"] };
}

describe("Week identity", () => {
  it("uses the local Monday across a UTC date boundary", () => {
    expect(getWeekIdentity("Asia/Manila", Date.parse("2026-08-16T16:30:00Z"))).toBe(
      MONDAY,
    );
    expect(getWeekIdentity("America/Los_Angeles", Date.parse("2026-08-17T06:30:00Z"))).toBe(
      "2026-08-10",
    );
  });

  it("uses local calendar arithmetic around a DST transition", () => {
    expect(getWeekIdentity("America/New_York", Date.parse("2026-03-09T04:00:00Z"))).toBe(
      "2026-03-09",
    );
  });
});

describe("CalendarDoc rollover", () => {
  it("carries templates and settings, resets Week-owned data, and carries immediate Sunday sleep", () => {
    const base = docAt(MONDAY);
    const doc: CalendarDoc = {
      ...base,
      days: {
        ...base.days,
        monday: {
          ...base.days.monday,
          items: [{
            _tag: "busy",
            id: "old",
            title: "Old",
            day: "monday",
            start: 600,
            end: 660,
          }],
        },
        sunday: {
          ...base.days.sunday,
          template: {
            ...base.days.sunday.template,
            sleep: [{ id: "night", start: 1380, end: 420 }],
          },
          items: [{
            _tag: "sleep",
            id: "exception",
            day: "sunday",
            start: 1380,
            end: 300,
          }],
          sleepOverride: [{ start: 1380, end: 360 }],
        },
      },
      todos: [{
        _tag: "todo",
        id: "todo",
        title: "Old todo",
        pomodoros: 1,
        priority: "P0",
      }],
    };

    const rolled = rolloverCalendarDoc(doc, NEXT_MONDAY);

    expect(rolled.weekStart).toBe(NEXT_MONDAY);
    expect(rolled.settings).toBe(doc.settings);
    expect(rolled.days.monday.template).toBe(doc.days.monday.template);
    expect(rolled.days.monday.items).toEqual([]);
    expect(rolled.days.sunday.sleepOverride).toBeUndefined();
    expect(rolled.todos).toEqual([]);
    expect(rolled.boundaryOccupancy).toEqual([
      { id: "boundary-override-0-1380-360", start: 0, end: 360 },
      { id: "boundary-one-off-exception", start: 0, end: 300 },
    ]);
  });

  it("carries recurring Sunday sleep after skipped Weeks but not one-off sleep", () => {
    const base = docAt();
    const doc: CalendarDoc = {
      ...base,
      days: {
        ...base.days,
        sunday: {
          ...base.days.sunday,
          template: {
            ...base.days.sunday.template,
            sleep: [{ id: "night", start: 1380, end: 420 }],
          },
          items: [{
            _tag: "sleep",
            id: "exception",
            day: "sunday",
            start: 1380,
            end: 300,
          }],
        },
      },
    };

    const rolled = rolloverCalendarDoc(doc, SKIPPED_MONDAY);

    expect(rolled.boundaryOccupancy).toEqual([
      { id: "boundary-template-night", start: 0, end: 420 },
    ]);
  });

  it("blocks Monday occupancy, collision checks, and derived schedule", () => {
    const doc = docAt(MONDAY);
    const boundary: BoundaryOccupancy[] = [{ id: "sleep", start: 0, end: 420 }];
    const day = doc.days.monday;
    const occupancy = getWeekDayOccupancy(day, boundary);

    expect(occupancy.occupiedIntervals).toContainEqual({ start: 0, end: 420 });
    expect(occupancy.freeSpans[0]).toEqual({ start: 420, end: 1440 });
    expect(wouldCollide(day, { tag: "busy", start: 60, end: 120 }, undefined, boundary)).toBe(
      true,
    );

    const scheduled = computeSchedule({ ...doc, boundaryOccupancy: boundary });
    expect(scheduled.monday.freeSpans[0]).toEqual({ start: 420, end: 1440 });
  });

  it("rejects incomplete and malformed persisted identity/boundary fields", () => {
    const doc = docAt(MONDAY);
    const withoutIdentity = { ...doc } as Record<string, unknown>;
    delete withoutIdentity.weekStart;
    expect(decodeCalendarDoc(withoutIdentity)._tag).toBe("Left");
    expect(decodeCalendarDoc({ ...doc, weekStart: "2026-08-18" })._tag).toBe("Left");
    expect(
      decodeCalendarDoc({
        ...doc,
        boundaryOccupancy: [{ id: "bad", start: 1, end: 0 }],
      })._tag,
    ).toBe("Left");
  });
});

describe("Storage rollover", () => {
  it("persists an exact rollover when loading with a controlled instant", async () => {
    const base = docAt(MONDAY);
    const initial: CalendarDoc = {
      ...base,
      days: {
        ...base.days,
        sunday: {
          ...base.days.sunday,
          template: {
            ...base.days.sunday.template,
            sleep: [{ id: "night", start: 1380, end: 420 }],
          },
        },
      },
    };
    const layer = makeMemoryStorageLayer(initial);
    const loaded = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const storage = yield* StorageService;
          return yield* storage.loadDoc(Date.parse("2026-08-24T12:00:00Z"));
        }),
        layer,
      ),
    );
    expect(loaded.weekStart).toBe(NEXT_MONDAY);
    expect(loaded.boundaryOccupancy).toEqual([
      { id: "boundary-template-night", start: 0, end: 420 },
    ]);
  });
});
