/** Pure Week-day occupancy tests. */

import { describe, expect, it } from "vitest";
import { getWeekDayOccupancy, spansOverlap, toIntervals } from "./occupancy";
import type { Day } from "./schema";

function createDay(partial: Partial<Day> = {}): Day {
  return {
    template: { busy: [], sleep: [] },
    items: [],
    ...partial,
  };
}

describe("Week-day occupancy", () => {
  it("expands template busy blocks with their source", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 600 }],
        sleep: [],
      },
    });

    expect(getWeekDayOccupancy(day).effectiveBlocks).toEqual([
      {
        _tag: "busy",
        id: "tb1",
        title: "Class",
        start: 540,
        end: 600,
        source: "template",
      },
    ]);
  });

  it("expands one-off items and a wrapping template sleep", () => {
    const day = createDay({
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Work",
          day: "monday",
          start: 720,
          end: 780,
        },
        {
          _tag: "event",
          id: "e1",
          title: "Doctor",
          day: "monday",
          start: 900,
          end: 960,
        },
        { _tag: "sleep", id: "s1", day: "monday", start: 60, end: 90 },
      ],
    });

    expect(getWeekDayOccupancy(day).effectiveBlocks).toEqual([
      {
        _tag: "busy",
        id: "b1",
        title: "Work",
        start: 720,
        end: 780,
        source: "one-off",
      },
      {
        _tag: "event",
        id: "e1",
        title: "Doctor",
        start: 900,
        end: 960,
        source: "one-off",
      },
      { _tag: "sleep", id: "s1", start: 60, end: 90, source: "one-off" },
      { _tag: "sleep", id: "ts1", start: 1380, end: 420, source: "template" },
    ]);
  });

  it("replaces template sleep with override sleep", () => {
    const day = createDay({
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      sleepOverride: [{ start: 60, end: 540 }],
    });

    expect(getWeekDayOccupancy(day).effectiveBlocks).toEqual([
      {
        _tag: "sleep",
        id: "override-0-60-540",
        start: 60,
        end: 540,
        source: "override",
      },
    ]);
  });

  it("keeps one-off sleep additive when an override is present", () => {
    const day = createDay({
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [
        { _tag: "sleep", id: "nap-1", day: "monday", start: 600, end: 660 },
      ],
      sleepOverride: [{ start: 60, end: 120 }],
    });

    expect(getWeekDayOccupancy(day)).toMatchObject({
      effectiveBlocks: [
        { id: "nap-1", source: "one-off" },
        { id: "override-0-60-120", source: "override" },
      ],
      occupiedIntervals: [
        { start: 60, end: 120 },
        { start: 600, end: 660 },
      ],
    });
  });

  it("uses an empty override to remove template sleep", () => {
    const day = createDay({
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      sleepOverride: [],
    });

    expect(getWeekDayOccupancy(day).effectiveBlocks).toEqual([]);
  });

  it("keeps deterministic block order: template busy, one-offs, sleep", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 600 }],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [
        {
          _tag: "event",
          id: "e1",
          title: "Doctor",
          day: "monday",
          start: 900,
          end: 960,
        },
      ],
    });

    const blocks = getWeekDayOccupancy(day).effectiveBlocks;
    expect(blocks.map((block) => block.source)).toEqual([
      "template",
      "one-off",
      "template",
    ]);
    expect(blocks.map((block) => block._tag)).toEqual([
      "busy",
      "event",
      "sleep",
    ]);
  });
});

describe("Week-day occupied and free intervals", () => {
  it("leaves an empty day entirely free", () => {
    expect(getWeekDayOccupancy(createDay()).freeSpans).toEqual([
      { start: 0, end: 1440 },
    ]);
  });

  it("subtracts blocks and exposes merged occupied intervals", () => {
    const day = createDay({
      template: {
        busy: [{ id: "tb1", title: "Part 1", start: 500, end: 600 }],
        sleep: [],
      },
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Part 2",
          day: "monday",
          start: 580,
          end: 700,
        },
        {
          _tag: "event",
          id: "e1",
          title: "Part 3",
          day: "monday",
          start: 700,
          end: 800,
        },
      ],
    });

    expect(getWeekDayOccupancy(day)).toMatchObject({
      occupiedIntervals: [{ start: 500, end: 800 }],
      freeSpans: [
        { start: 0, end: 500 },
        { start: 800, end: 1440 },
      ],
    });
  });

  it("subtracts the two parts of a wrapping sleep", () => {
    const day = createDay({
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
    });

    expect(getWeekDayOccupancy(day)).toMatchObject({
      occupiedIntervals: [
        { start: 0, end: 420 },
        { start: 1380, end: 1440 },
      ],
      freeSpans: [{ start: 420, end: 1380 }],
    });
  });

  it("uses override sleep instead of template sleep for free time", () => {
    const day = createDay({
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      sleepOverride: [{ start: 60, end: 540 }],
    });

    expect(getWeekDayOccupancy(day).freeSpans).toEqual([
      { start: 0, end: 60 },
      { start: 540, end: 1440 },
    ]);
  });
});

describe("occupancy interval projection", () => {
  it("keeps forward spans as one interval", () => {
    expect(toIntervals({ start: 540, end: 600 })).toEqual([
      { start: 540, end: 600 },
    ]);
  });

  it("splits wrapping spans at midnight", () => {
    expect(toIntervals({ start: 1380, end: 420 })).toEqual([
      { start: 1380, end: 1440 },
      { start: 0, end: 420 },
    ]);
  });

  it("drops zero-length spans", () => {
    expect(toIntervals({ start: 600, end: 600 })).toEqual([]);
  });

  it("uses strict overlap and permits touching spans", () => {
    expect(
      spansOverlap({ start: 540, end: 600 }, { start: 570, end: 660 }),
    ).toBe(true);
    expect(
      spansOverlap({ start: 540, end: 600 }, { start: 600, end: 660 }),
    ).toBe(false);
    expect(
      spansOverlap({ start: 540, end: 600 }, { start: 660, end: 720 }),
    ).toBe(false);
  });

  it("checks overlap across midnight", () => {
    expect(
      spansOverlap({ start: 1380, end: 420 }, { start: 300, end: 600 }),
    ).toBe(true);
    expect(
      spansOverlap({ start: 1380, end: 240 }, { start: 240, end: 360 }),
    ).toBe(false);
  });
});
