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
  resolveResize,
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
      items: [
        {
          _tag: "busy",
          id: "other",
          title: "Lunch",
          day: "monday",
          start: 600,
          end: 660,
        },
      ],
    });
    expect(resolvePlacement(day, REQUEST)).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });

  it("accepts a back-to-back placement (touching, not overlapping)", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Class", start: 600, end: 660 }],
        sleep: [],
      },
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 570 }],
        sleep: [],
      },
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 585 }],
        sleep: [],
      },
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 570 }],
        sleep: [],
      },
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 570 }],
        sleep: [],
      },
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 590 }],
        sleep: [],
      },
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 600 }],
        sleep: [],
      },
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
      items: [
        {
          _tag: "busy",
          id: "wall",
          title: "Wall",
          day: "tuesday",
          start: 0,
          end: 1440,
        },
      ],
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
      items: [
        {
          _tag: "busy",
          id: "wall",
          title: "Wall",
          day: "monday",
          start: 0,
          end: 1440,
        },
      ],
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
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Me",
          day: "monday",
          start: 540,
          end: 600,
        },
      ],
    });
    expect(resolvePlacement(day, REQUEST, "b1")).toEqual({
      start: 540,
      end: 600,
      adjusted: false,
    });
  });

  it("does not exclude a different item", () => {
    const day = createDay({
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Other",
          day: "monday",
          start: 540,
          end: 600,
        },
      ],
    });
    // Moving a different item (id "someone-else") still collides and must adjust.
    expect(resolvePlacement(day, REQUEST, "someone-else")).toEqual({
      start: 600,
      end: 660,
      adjusted: true,
    });
  });

  it("treats week-boundary occupancy as participating occupancy (read-only)", () => {
    const boundary: BoundaryOccupancy[] = [
      { id: "boundary-1", start: 0, end: 600 },
    ];
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
    const boundary: BoundaryOccupancy[] = [
      { id: "boundary-1", start: 0, end: 120 },
    ];
    expect(resolvePlacement(createDay(), REQUEST, undefined, boundary)).toEqual(
      {
        start: 540,
        end: 600,
        adjusted: false,
      },
    );
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 0, end: 300 }],
        sleep: [],
      },
    });
    // The overnight sleep tail [0,420] overlaps 00:00–05:00. Shortening is
    // undefined for a wrapping span, so the resolver refuses instead of
    // turning an overnight sleep into a forward day-time block.
    expect(resolvePlacement(day, sleep)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resize resolution (#20)
// ---------------------------------------------------------------------------

describe("resolveResize — forward spans, start edge", () => {
  it("shrinks from the start edge exactly as requested (end fixed, no collision)", () => {
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    expect(
      resolveResize(createDay(), current, { edge: "start", value: 570 }),
    ).toEqual({
      start: 570,
      end: 600,
      adjusted: false,
    });
  });

  it("extends the start edge earlier, clamping at the first occupancy boundary", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Class", start: 500, end: 520 }],
        sleep: [],
      },
    });
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    // Requested [480,600] collides with [500,520]; the active start clamps to
    // the first clear boundary (520) instead of creating an overlap.
    expect(resolveResize(day, current, { edge: "start", value: 480 })).toEqual({
      start: 520,
      end: 600,
      adjusted: true,
    });
  });

  it("refuses a start-edge shrink shorter than 15 minutes", () => {
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    // [590,600] is only 10 minutes.
    expect(
      resolveResize(createDay(), current, { edge: "start", value: 590 }),
    ).toBeNull();
  });

  it("refuses a start-edge change that crosses the fixed end edge", () => {
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    expect(
      resolveResize(createDay(), current, { edge: "start", value: 600 }),
    ).toBeNull();
    expect(
      resolveResize(createDay(), current, { edge: "start", value: 660 }),
    ).toBeNull();
  });
});

describe("resolveResize — forward spans, end edge", () => {
  it("shrinks from the end edge exactly as requested (start fixed)", () => {
    const current = { tag: "event" as const, start: 540, end: 600, id: "e1" };
    expect(
      resolveResize(createDay(), current, { edge: "end", value: 570 }),
    ).toEqual({
      start: 540,
      end: 570,
      adjusted: false,
    });
  });

  it("extends the end edge later, clamping at the first occupancy boundary", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Class", start: 660, end: 700 }],
        sleep: [],
      },
    });
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    // Requested [540,720] collides with [660,700]; the active end clamps to
    // the first clear boundary (660) instead of overlapping.
    expect(resolveResize(day, current, { edge: "end", value: 720 })).toEqual({
      start: 540,
      end: 660,
      adjusted: true,
    });
  });

  it("refuses an end-edge shrink shorter than 15 minutes", () => {
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    expect(
      resolveResize(createDay(), current, { edge: "end", value: 550 }),
    ).toBeNull();
  });

  it("refuses an extension clamped entirely back to the original edge", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Wall", start: 600, end: 1440 }],
        sleep: [],
      },
    });
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    // Extending the end to 720 can only land back on 600 (blocked immediately);
    // the resize is refused rather than silently reporting a no-op change.
    expect(resolveResize(day, current, { edge: "end", value: 720 })).toBeNull();
  });
});

describe("resolveResize — wrapping sleep", () => {
  it("preserves the start and shortens the trailing portion first when extended into occupancy", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Morning", start: 540, end: 600 }],
        sleep: [],
      },
    });
    const current = { tag: "sleep" as const, start: 1380, end: 420, id: "s1" };
    // Waking at 10:00 ([1380,600]) collides with [540,600]; the trailing
    // portion shortens, clamping the end to 540 while the start (23:00) holds.
    expect(resolveResize(day, current, { edge: "end", value: 600 })).toEqual({
      start: 1380,
      end: 540,
      adjusted: true,
    });
  });

  it("shrinks the trailing portion exactly as requested, preserving the start", () => {
    const current = { tag: "sleep" as const, start: 1380, end: 420, id: "s1" };
    expect(
      resolveResize(createDay(), current, { edge: "end", value: 300 }),
    ).toEqual({
      start: 1380,
      end: 300,
      adjusted: false,
    });
  });

  it("refuses a wrapping-sleep start-edge resize (start is preserved, not adjustable)", () => {
    const current = { tag: "sleep" as const, start: 1380, end: 420, id: "s1" };
    expect(
      resolveResize(createDay(), current, { edge: "start", value: 1200 }),
    ).toBeNull();
  });

  it("refuses a wrapping-sleep resize that would stop wrapping", () => {
    const current = { tag: "sleep" as const, start: 1380, end: 420, id: "s1" };
    // Waking at or after 23:00 no longer wraps midnight.
    expect(
      resolveResize(createDay(), current, { edge: "end", value: 1380 }),
    ).toBeNull();
  });

  it("refuses a wrapping-sleep resize shorter than 15 minutes", () => {
    // Current spans 23:59–00:20 = 21 minutes; shrinking the end to 00:10
    // leaves only 11 minutes.
    const current = { tag: "sleep" as const, start: 1439, end: 20, id: "s1" };
    expect(
      resolveResize(createDay(), current, { edge: "end", value: 10 }),
    ).toBeNull();
  });
});

describe("resolveResize — self-exclusion & boundary occupancy", () => {
  it("excludes the resized item from its own occupancy check", () => {
    const day = createDay({
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Me",
          day: "monday",
          start: 540,
          end: 600,
        },
      ],
    });
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    // Extending the end past the item's own current span must not collide
    // with the item itself.
    expect(resolveResize(day, current, { edge: "end", value: 720 })).toEqual({
      start: 540,
      end: 720,
      adjusted: false,
    });
  });

  it("treats week-boundary occupancy as participating, read-only occupancy", () => {
    const boundary: BoundaryOccupancy[] = [
      { id: "boundary-1", start: 0, end: 300 },
    ];
    const day = createDay();
    const current = { tag: "busy" as const, start: 360, end: 480, id: "b1" };
    // Extending the start to 240 collides with the boundary [0,300]; the
    // active start clamps to 300 instead of overlapping, and boundary is not
    // mutated.
    expect(
      resolveResize(day, current, { edge: "start", value: 240 }, boundary),
    ).toEqual({
      start: 300,
      end: 480,
      adjusted: true,
    });
    expect(boundary).toEqual([{ id: "boundary-1", start: 0, end: 300 }]);
  });

  it("leaves the source span unchanged on refusal (pure function)", () => {
    const current = { tag: "busy" as const, start: 540, end: 600, id: "b1" };
    resolveResize(createDay(), current, { edge: "start", value: 590 });
    expect(current).toEqual({ tag: "busy", start: 540, end: 600, id: "b1" });
  });
});
