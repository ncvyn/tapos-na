/**
 * Day item move-resolution core unit tests (#19).
 *
 * Pure, deterministic tests for `resolvePlacement` — the single shared
 * placement-resolution behavior behind every Busy/Event/Sleep move:
 * preserve the exact wall-clock span when possible, shorten from the
 * requested start when at least 15 minutes remain, otherwise find the
 * nearest alternate start on the target Week day (later candidates win
 * ties), and refuse when no 15-minute placement exists.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_PLACEMENT_MINUTES,
  resolvePlacement,
  type RequestedPlacement,
} from "./placement";
import type { BoundaryOccupancy, Day } from "./schema";

function createDay(partial: Partial<Day> = {}): Day {
  return {
    template: { busy: [], sleep: [] },
    items: [],
    ...partial,
  };
}

/** 09:00–10:00 busy move onto a target Week day. */
const REQUEST: RequestedPlacement = {
  tag: "busy",
  start: 540,
  end: 600,
};

// ---------------------------------------------------------------------------
// Exact & back-to-back placements
// ---------------------------------------------------------------------------

describe("resolvePlacement — exact & back-to-back", () => {
  it("returns an empty day's exact placement unchanged (adjusted=false)", () => {
    expect(resolvePlacement(createDay(), REQUEST)).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });

  it("preserves the wall-clock span for an exact non-colliding placement", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "other", title: "Lunch", day: "monday", start: 600, end: 660 }],
    });
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });

  it("accepts a back-to-back placement (touching, not overlapping)", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 600, end: 660 }], sleep: [] },
    });
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Shortening from the requested start
// ---------------------------------------------------------------------------

describe("resolvePlacement — shorten from the requested start", () => {
  it("shortens from the requested start, keeping the end fixed, when >=15min remain", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 540, end: 570 }], sleep: [] },
    });
    // Exact [540,600] collides; pushing the start to 570 keeps [570,600] = 30min.
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 570,
      end: 600,
      adjusted: true,
    });
  });

  it("shortens to exactly the 15-minute floor when that is all that remains", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 540, end: 585 }], sleep: [] },
    });
    // Only [585,600] = 15min fits with the end fixed.
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 585,
      end: 600,
      adjusted: true,
    });
    expect(600 - 585).toBe(MIN_PLACEMENT_MINUTES);
  });

  it("shares the behavior for sleep moves (forward sleep shortens too)", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 540, end: 570 }], sleep: [] },
    });
    const sleep: RequestedPlacement = { tag: "sleep", start: 540, end: 660 };
    expect(resolvePlacement(day, sleep)).toEqual({
      start: 570,
      end: 660,
      adjusted: true,
    });
  });

  it("shares the behavior for event moves", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 540, end: 570 }], sleep: [] },
    });
    const event: RequestedPlacement = { tag: "event", start: 540, end: 660 };
    expect(resolvePlacement(day, event)).toEqual({
      start: 570,
      end: 660,
      adjusted: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Nearest alternate start
// ---------------------------------------------------------------------------

describe("resolvePlacement — nearest alternate start", () => {
  it("falls back to the nearest alternate start when shortening can't keep 15min", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 540, end: 590 }], sleep: [] },
    });
    // Shorten: end fixed at 600, s <= 585, but [s,600] overlaps [540,590] until s>=590 (>585).
    // Alternate: nearest 60-min gap to 540 is [590,650] (dist 50).
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 590,
      end: 650,
      adjusted: true,
    });
  });

  it("prefers later candidates when two starts are equidistant from the request", () => {
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 540, end: 600 }], sleep: [] },
    });
    // [0,540] and [600,1440] are both free; starts 480 and 600 are both 60 away.
    // Later candidate (600) wins the tie.
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 600,
      end: 660,
      adjusted: true,
    });
  });

  it("never searches another Week day — a fully-occupied target refuses", () => {
    const fullyOccupied = createDay({
      items: [{ _tag: "busy", id: "wall", title: "Wall", day: "tuesday", start: 0, end: 1440 }],
    });
    // The request is trivially placeable on an empty source day, but the
    // resolver only has the target day, so it must refuse.
    expect(resolvePlacement(fullyOccupied, REQUEST)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refusal
// ---------------------------------------------------------------------------

describe("resolvePlacement — refusal", () => {
  it("refuses when no 15-minute placement exists on the target day", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "wall", title: "Wall", day: "monday", start: 0, end: 1440 }],
    });
    expect(resolvePlacement(day, REQUEST)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Self-exclusion & boundary occupancy
// ---------------------------------------------------------------------------

describe("resolvePlacement — self-exclusion & boundary occupancy", () => {
  it("excludes the moving item from its own occupancy check (within-day move)", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "b1", title: "Me", day: "monday", start: 540, end: 600 }],
    });
    expect(resolvePlacement(day, REQUEST, "b1")).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });

  it("does not exclude a different item", () => {
    const day = createDay({
      items: [{ _tag: "busy", id: "b1", title: "Other", day: "monday", start: 540, end: 600 }],
    });
    // Moving a different item (id "someone-else") still collides and must adjust.
    expect(resolvePlacement(day, REQUEST, "someone-else")).toEqual({
      start: 600,
      end: 660,
      adjusted: true,
    });
  });

  it("treats week-boundary occupancy as participating occupancy (read-only)", () => {
    const boundary: BoundaryOccupancy[] = [{ id: "boundary-1", start: 0, end: 600 }];
    const day = createDay();
    // Boundary sleep occupies [0,600]; the exact [540,600] collides, so the
    // resolver moves it after the boundary instead of placing it inside.
    expect(resolvePlacement(day, REQUEST, undefined, boundary)).toEqual({
      start: 600,
      end: 660,
      adjusted: true,
    });
    // Boundary input is consulted, never mutated.
    expect(boundary).toEqual([{ id: "boundary-1", start: 0, end: 600 }]);
  });

  it("preserves an exact placement when boundary occupancy does not overlap", () => {
    const boundary: BoundaryOccupancy[] = [{ id: "boundary-1", start: 0, end: 120 }];
    expect(resolvePlacement(createDay(), REQUEST, undefined, boundary)).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Wrapping sleep
// ---------------------------------------------------------------------------

describe("resolvePlacement — wrapping sleep", () => {
  it("preserves an exact non-colliding wrapping sleep", () => {
    const sleep: RequestedPlacement = { tag: "sleep", start: 1380, end: 420 };
    expect(resolvePlacement(createDay(), sleep)).toEqual({
      start: 1380,
      end: 420,
      adjusted: false,
    });
  });

  it("refuses a colliding wrapping sleep rather than reshaping it", () => {
    const sleep: RequestedPlacement = { tag: "sleep", start: 1380, end: 420 }; // 480min
    const day = createDay({
      template: { busy: [{ id: "tb1", title: "Class", start: 0, end: 300 }], sleep: [] },
    });
    // The overnight sleep tail [0,420] overlaps 00:00–05:00. Shortening is
    // undefined for a wrapping span, so the resolver refuses instead of
    // turning an overnight sleep into a forward day-time block.
    expect(resolvePlacement(day, sleep)).toBeNull();
  });
});
