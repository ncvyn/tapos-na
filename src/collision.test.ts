/**
 * Collision-prevention core unit tests (T10).
 *
 * Pure, deterministic tests for movement policy: `wouldCollide` against a
 * day's Week-day occupancy.
 */

import { describe, expect, it } from "vitest";
import { wouldCollide } from "./collision";
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
// wouldCollide
// ---------------------------------------------------------------------------

describe("wouldCollide", () => {
  it("an empty day never collides", () => {
    const day = createDay();
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(false);
  });

  it("collides with a template busy block", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Class", start: 570, end: 630 }],
        sleep: [],
      },
    });
    expect(wouldCollide(day, BUSY_PLACEMENT)).toBe(true);
  });

  it("collides with a one-off event", () => {
    const day = createDay({
      items: [
        {
          _tag: "event",
          id: "e1",
          title: "Dr",
          day: "monday",
          start: 540,
          end: 600,
        },
      ],
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
      template: {
        busy: [{ id: "tb1", title: "Class", start: 600, end: 660 }],
        sleep: [],
      },
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
    // Same placement, same id: the item must not collide with itself.
    expect(wouldCollide(day, BUSY_PLACEMENT, "b1")).toBe(false);
  });

  it("collides with a different item even when a moving id is passed", () => {
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
    expect(wouldCollide(day, BUSY_PLACEMENT, "someone-else")).toBe(true);
  });

  it("checks a wrapping sleep placement against a forward block", () => {
    const day = createDay({
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Class",
          day: "monday",
          start: 300,
          end: 600,
        },
      ],
    });
    expect(
      wouldCollide(day, { tag: "sleep", start: 1380, end: 420 }, "sleep-1"),
    ).toBe(true);
  });
});
