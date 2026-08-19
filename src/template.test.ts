/**
 * Schedule placement tests against Week-day occupancy (T6-T7).
 *
 * Derived pomodoros respect the Week-day occupancy module's effective blocks.
 */

import { describe, expect, it } from "vitest";
import {
  computeDaySchedule,
  computeSchedule,
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
        todo: {
          _tag: "todo",
          id: "t1",
          title: "Task",
          pomodoros: 2,
          priority: "P0",
        },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todoProgress,
      settings,
      "monday",
    );

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
        todo: {
          _tag: "todo",
          id: "t1",
          title: "Task",
          pomodoros: 2,
          priority: "P0",
        },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todoProgress,
      settings,
      "monday",
    );

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
        todo: {
          _tag: "todo",
          id: "t1",
          title: "Task",
          pomodoros: 2,
          priority: "P0",
        },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todoProgress,
      settings,
      "monday",
    );

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
        todo: {
          _tag: "todo",
          id: "t1",
          title: "Task",
          pomodoros: 2,
          priority: "P0",
        },
        remainingPomodoros: 2,
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todoProgress,
      settings,
      "monday",
    );

    expect(daySchedule.segments.length).toBeGreaterThan(0);
    for (const seg of daySchedule.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(720);
    }
  });

  it("an empty day template leaves the whole day free", () => {
    const day: Day = { template: { busy: [], sleep: [] }, items: [] };

    const todoProgress: TodoProgress[] = [
      {
        todo: {
          _tag: "todo",
          id: "t1",
          title: "Task",
          pomodoros: 1,
          priority: "P1",
        },
        remainingPomodoros: 1,
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todoProgress,
      settings,
      "monday",
    );
    expect(daySchedule.segments[0]).toMatchObject({
      _tag: "work",
      start: 0,
      end: 25,
    });
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
      weekIdentity: "2026-08-10",
      boundaryOccupancy: [],
      settings,
      days,
      todos: [
        {
          _tag: "todo",
          id: "t1",
          title: "Big Task",
          pomodoros: 5,
          priority: "P0",
        },
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
