/**
 * Weekly template → effective blocks expansion tests (T6).
 *
 * `expandDay` is the pure template-expansion seam: it turns a day's template
 * (recurring busy + sleep), one-off items, and any sleep override into a
 * flat, deterministic list of effective blocks that both the engine
 * (`getFreeSpans`) and the UI (template-inherited vs. one-off badges) consume.
 *
 * Rules under test:
 * 1. Template busy/sleep blocks are marked `template`.
 * 2. One-off day items are marked `one-off`.
 * 3. A sleep override replaces that day's template sleep only; the produced
 *    blocks are marked `override` and the template sleep is absent.
 * 4. Derived pomodoros respect the expanded busy/sleep blocks.
 */

import { describe, expect, it } from "vitest";
import {
  computeDaySchedule,
  computeSchedule,
  expandDay,
  type TodoProgress,
} from "./engine";
import {
  type CalendarDoc,
  type Day,
  type DayOfWeek,
  Settings,
  WEEKDAY_NAMES,
} from "./schema";

const settings: Settings = {
  workLength: 25,
  breakLength: 5,
  longBreakLength: 30,
  miniFocus: true,
  timezone: "UTC",
};

// ---------------------------------------------------------------------------
// Template → effective blocks expansion
// ---------------------------------------------------------------------------

describe("expandDay (template expansion seam)", () => {
  it("expands template busy blocks as source 'template'", () => {
    const day: Day = {
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 600 }],
        sleep: [],
      },
      items: [],
    };

    expect(expandDay(day)).toEqual([
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

  it("expands template sleep windows (incl. cross-midnight) as source 'template'", () => {
    const day: Day = {
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [],
    };

    expect(expandDay(day)).toEqual([
      { _tag: "sleep", id: "ts1", start: 1380, end: 420, source: "template" },
    ]);
  });

  it("expands one-off day items (busy, event, sleep) as source 'one-off'", () => {
    const day: Day = {
      template: { busy: [], sleep: [] },
      items: [
        { _tag: "busy", id: "b1", title: "Work", day: "monday", start: 720, end: 780 },
        { _tag: "event", id: "e1", title: "Dr", day: "monday", start: 900, end: 960 },
        { _tag: "sleep", id: "s1", day: "monday", start: 60, end: 90 },
      ],
    };

    expect(expandDay(day)).toEqual([
      { _tag: "busy", id: "b1", title: "Work", start: 720, end: 780, source: "one-off" },
      { _tag: "event", id: "e1", title: "Dr", start: 900, end: 960, source: "one-off" },
      { _tag: "sleep", id: "s1", start: 60, end: 90, source: "one-off" },
    ]);
  });

  it("sleep override replaces template sleep; blocks carry source 'override'", () => {
    const day: Day = {
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [],
      sleepOverride: [{ start: 60, end: 540 }],
    };

    expect(expandDay(day)).toEqual([
      {
        _tag: "sleep",
        id: "override-0-60-540",
        start: 60,
        end: 540,
        source: "override",
      },
    ]);
  });

  it("produces a deterministic order: template busy, one-off items, sleep", () => {
    const day: Day = {
      template: {
        busy: [{ id: "tb1", title: "Class", start: 540, end: 600 }],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [
        { _tag: "event", id: "e1", title: "Dr", day: "monday", start: 900, end: 960 },
      ],
    };

    const blocks = expandDay(day);
    expect(blocks.map((b) => b.source)).toEqual([
      "template",
      "one-off",
      "template",
    ]);
    expect(blocks.map((b) => b._tag)).toEqual(["busy", "event", "sleep"]);
  });
});

// ---------------------------------------------------------------------------
// Derived pomodoros respect expanded template blocks
// ---------------------------------------------------------------------------

describe("derived schedule respects expanded template", () => {
  it("does not place pomodoros inside a template busy block", () => {
    const day: Day = {
      template: {
        busy: [{ id: "tb1", title: "Class", start: 0, end: 720 }],
        sleep: [],
      },
      items: [],
    };

    const todoProgress: TodoProgress[] = [
      {
        todo: { _tag: "todo", id: "t1", title: "Task", pomodoros: 2, priority: "P0" },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(day, todoProgress, settings, "monday");

    expect(daySchedule.segments.length).toBeGreaterThan(0);
    for (const seg of daySchedule.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(720);
    }
  });

  it("does not place pomodoros inside a template sleep window", () => {
    const day: Day = {
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 0, end: 480 }],
      },
      items: [],
    };

    const todoProgress: TodoProgress[] = [
      {
        todo: { _tag: "todo", id: "t1", title: "Task", pomodoros: 2, priority: "P0" },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(day, todoProgress, settings, "monday");

    expect(daySchedule.segments.length).toBeGreaterThan(0);
    for (const seg of daySchedule.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(480);
    }
  });

  it("does not place pomodoros inside a cross-midnight template sleep window", () => {
    const day: Day = {
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 1380, end: 420 }],
      },
      items: [],
    };

    const todoProgress: TodoProgress[] = [
      {
        todo: { _tag: "todo", id: "t1", title: "Task", pomodoros: 2, priority: "P0" },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(day, todoProgress, settings, "monday");

    expect(daySchedule.segments.length).toBeGreaterThan(0);
    for (const seg of daySchedule.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(420);
      expect(seg.end).toBeLessThanOrEqual(1380);
    }
  });

  it("does not place pomodoros inside a sleep override window", () => {
    const day: Day = {
      template: {
        busy: [],
        sleep: [{ id: "ts1", start: 0, end: 480 }],
      },
      items: [],
      sleepOverride: [{ start: 0, end: 720 }],
    };

    const todoProgress: TodoProgress[] = [
      {
        todo: { _tag: "todo", id: "t1", title: "Task", pomodoros: 2, priority: "P0" },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(day, todoProgress, settings, "monday");

    expect(daySchedule.segments.length).toBeGreaterThan(0);
    for (const seg of daySchedule.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(720);
    }
  });

  it("an empty day template leaves the whole day free", () => {
    const day: Day = { template: { busy: [], sleep: [] }, items: [] };

    const todoProgress: TodoProgress[] = [
      {
        todo: { _tag: "todo", id: "t1", title: "Task", pomodoros: 1, priority: "P1" },
        remainingPomodoros: 1,
      },
    ];

    const { daySchedule } = computeDaySchedule(day, todoProgress, settings, "monday");
    expect(daySchedule.segments[0]).toMatchObject({ _tag: "work", start: 0, end: 25 });
  });
});

// ---------------------------------------------------------------------------
// Sleep override isolation
// ---------------------------------------------------------------------------

describe("sleep override isolation", () => {
  const nightDay = (dayName: DayOfWeek): Day => ({
    template: {
      busy: [],
      sleep: [{ id: `ts-${dayName}`, start: 1380, end: 420 }],
    },
    items: [],
  });

  function baseDoc(): CalendarDoc {
    const days = {} as Record<DayOfWeek, Day>;
    for (const d of WEEKDAY_NAMES) days[d] = nightDay(d);
    return {
      version: 1,
      settings,
      days,
      todos: [
        { _tag: "todo", id: "t1", title: "Big Task", pomodoros: 5, priority: "P0" },
      ],
    };
  }

  it("adding a sleep override to one day leaves other days' schedules identical", () => {
    const schedNoOverride = computeSchedule(baseDoc());

    const withOverride: CalendarDoc = {
      ...baseDoc(),
      days: {
        ...baseDoc().days,
        monday: {
          ...baseDoc().days.monday,
          sleepOverride: [{ start: 0, end: 720 }],
        },
      },
    };
    const schedOverride = computeSchedule(withOverride);

    // Tuesday (no override) must be identical to the baseline
    expect(schedOverride.tuesday).toEqual(schedNoOverride.tuesday);
    expect(schedOverride.wednesday).toEqual(schedNoOverride.wednesday);

    // Monday with the override differs from the baseline
    expect(schedOverride.monday).not.toEqual(schedNoOverride.monday);
  });

  it("an override is not shared across days — cleared override restores template sleep", () => {
    const withOverride: CalendarDoc = {
      ...baseDoc(),
      days: {
        ...baseDoc().days,
        monday: {
          ...baseDoc().days.monday,
          sleepOverride: [{ start: 0, end: 720 }],
        },
      },
    };
    const cleared: CalendarDoc = {
      ...withOverride,
      days: {
        ...withOverride.days,
        monday: { ...withOverride.days.monday, sleepOverride: undefined },
      },
    };

    expect(computeSchedule(cleared).monday).toEqual(
      computeSchedule(baseDoc()).monday,
    );
  });
});
