/**
 * Collision-prevention core unit tests (T10).
 *
 * Pure, deterministic tests for the drag & drop collision seam: interval
 * overlap (wrap-aware for sleep), span math for a dragged item's new time,
 * and `wouldCollide` against a day's effective occupying blocks — the same
 * block model the engine subtracts from the day to find free time, so a
 * refused drop is exactly one that would break scheduling constraints.
 */

import { describe, expect, it } from "vitest";
import {
  spanForNewStart,
  spanLength,
  spansOverlap,
  toIntervals,
  wouldCollide,
} from "./collision";
import type { Day } from "./schema";

function createDay(partial: Partial<Day> = {}): Day {
  return {
    template: { busy: [], sleep: [] },
    items: [],
    ...partial,
  };
}

const BUSY_PLACEMENT = { tag: "busy" as const, start: 540, end: 600 }; // 09:00–10:00

// ---------------------------------------------------------------------------
// toIntervals
// ---------------------------------------------------------------------------

describe("toIntervals", () => {
  it("returns a single interval for a forward span", () => {
    expect(toIntervals({ start: 540, end: 600 })).toEqual([
      { start: 540, end: 600 },
    ]);
  });

  it("splits a midnight-wrapping span into [start,1440] and [0,end]", () => {
    expect(toIntervals({ start: 1380, end: 420 })).toEqual([
      { start: 1380, end: 1440 },
      { start: 0, end: 420 },
    ]);
  });

  it("returns no intervals for a zero-length span", () => {
    expect(toIntervals({ start: 600, end: 600 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// spansOverlap
// ---------------------------------------------------------------------------

describe("spansOverlap", () => {
  it("reports overlap for intersecting forward spans", () => {
    expect(spansOverlap({ start: 540, end: 600 }, { start: 570, end: 660 })).toBe(
      true,
    );
  });

  it("reports overlap for containment", () => {
    expect(spansOverlap({ start: 500, end: 700 }, { start: 540, end: 600 })).toBe(
      true,
    );
  });

  it("allows back-to-back (touching) spans", () => {
    expect(spansOverlap({ start: 540, end: 600 }, { start: 600, end: 660 })).toBe(
      false,
    );
  });

  it("rejects disjoint spans", () => {
    expect(spansOverlap({ start: 540, end: 600 }, { start: 660, end: 720 })).toBe(
      false,
    );
  });

  it("detects a wrapping sleep overlapping a morning forward block", () => {
    expect(spansOverlap({ start: 1380, end: 420 }, { start: 300, end: 600 })).toBe(
      true,
    );
  });

  it("detects two wrapping spans that share the early-morning tail", () => {
    expect(spansOverlap({ start: 1380, end: 420 }, { start: 360, end: 780 })).toBe(
      true,
    );
  });

  it("allows a wrapping span ending exactly when a forward block starts", () => {
    // sleep 23:00→04:00 covers [1380,1440]+[0,240]; busy 04:00→06:00 touches it.
    expect(spansOverlap({ start: 1380, end: 240 }, { start: 240, end: 360 })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// spanLength
// ---------------------------------------------------------------------------

describe("spanLength", () => {
  it("measures a forward span", () => {
    expect(spanLength({ start: 540, end: 600 })).toBe(60);
  });

  it("measures a wrapping span across midnight", () => {
    expect(spanLength({ start: 1380, end: 420 })).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// spanForNewStart
// ---------------------------------------------------------------------------

describe("spanForNewStart", () => {
  it("moves a busy span keeping its duration", () => {
    expect(spanForNewStart("busy", { start: 540, end: 600 }, 720)).toEqual({
      start: 720,
      end: 780,
    });
  });

  it("moves an event span keeping its duration", () => {
    expect(spanForNewStart("event", { start: 540, end: 600 }, 120)).toEqual({
      start: 120,
      end: 180,
    });
  });

  it("refuses a busy span that would overflow the day", () => {
    expect(spanForNewStart("busy", { start: 540, end: 600 }, 1410)).toBeNull();
  });

  it("refuses an event span that would overflow the day", () => {
    expect(spanForNewStart("event", { start: 540, end: 600 }, 1390)).toBeNull();
  });

  it("keeps a sleep span's duration when it stays forward", () => {
    expect(spanForNewStart("sleep", { start: 1380, end: 420 }, 120)).toEqual({
      start: 120,
      end: 600,
    });
  });

  it("wraps a sleep span that crosses midnight after the move", () => {
    expect(spanForNewStart("sleep", { start: 600, end: 660 }, 1380)).toEqual({
      start: 1380,
      end: 0,
    });
  });

  it("keeps a wrapping sleep span wrapping after the move", () => {
    expect(spanForNewStart("sleep", { start: 1380, end: 420 }, 1380)).toEqual({
      start: 1380,
      end: 420,
    });
  });

  it("returns null for a zero-length original span", () => {
    expect(spanForNewStart("busy", { start: 600, end: 600 }, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wouldCollide
// ---------------------------------------------------------------------------

describe("wouldCollide", () => {
  it("an empty day never collides", () => {
    const day = createDay();
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(false);
  });

  it("collides with a template busy block", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 570, end: 630 }], sleep: [] },
    });
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(true);
  });

  it("collides with a one-off event", () => {
    const day = createDay({
      items: [{ _tag: "event", id: "e1", title: "Dr", day: "monday", start: 540, end: 600 }],
    });
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(true);
  });

  it("collides with a template sleep block", () => {
    const day = createDay({
      template: { busy: [], sleep: [{ id: "ts1", start: 1380, end: 600 }] },
    });
    // proposed 09:00–10:00 overlaps the 00:00–10:00 tail of the wrapping sleep
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(true);
  });

  it("collides with an override sleep block", () => {
    const day = createDay({
      sleepOverride: [{ start: 540, end: 600 }],
    });
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(true);
  });

  it("allows a back-to-back drop next to a template block", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 600, end: 660 }], sleep: [] },
    });
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(false);
  });

  it("collides across item kinds (busy into a sleep block)", () => {
    const day = createDay({
      items: [{ _tag: "sleep", id: "s1", day: "monday", start: 540, end: 660 }],
    });
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(true);
  });

  it("ignores the moving item itself on its source day", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "b1", title: "Me", day: "monday", start: 540, end: 600 }],
    });
    // Same placement, same id: the item must not collide with itself.
    expect(wouldCollide(day, BUSY_PLACEMENT, "b1")).toBe(false);
  });

  it("collides with a different item even when a moving id is passed", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "b1", title: "Me", day: "monday", start: 540, end: 600 }],
    });
    expect(wouldCollide(day, BUSY_PLACEMENT, "someone-else")).toBe(true);
  });

  it("checks a wrapping sleep placement against a forward block", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "b1", title: "Class", day: "monday", start: 300, end: 600 }],
    });
    expect(
      wouldCollide(day, { tag: "sleep", start: 1380, end: 420 }, "sleep-1"),
    ).toBe(true);
  });
});
