/**
 * Engine core unit tests (T4–T7).
 * Pure, deterministic, test-first tests for schedule derivation.
 */

import { describe, expect, it } from "vitest";
import {
  computeDaySchedule,
  computeSchedule,
  type TodoProgress,
  type WorkSegment,
} from "./engine";
import { CalendarDoc, Day, Settings, Todo, WEEKDAY_NAMES } from "./schema";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const defaultSettings: Settings = {
  workLength: 25,
  breakLength: 5,
  longBreakLength: 30,
  miniFocus: true,
  timezone: "UTC",
};

const emptyDayTemplate = { busy: [], sleep: [] };

function createEmptyDay(): Day {
  return {
    template: emptyDayTemplate,
    items: [],
  };
}

function createSampleDoc(): CalendarDoc {
  return {
    version: 1,
    weekIdentity: "2026-08-10",
    boundaryOccupancy: [],
    settings: defaultSettings,
    days: {
      monday: createEmptyDay(),
      tuesday: createEmptyDay(),
      wednesday: createEmptyDay(),
      thursday: createEmptyDay(),
      friday: createEmptyDay(),
      saturday: createEmptyDay(),
      sunday: createEmptyDay(),
    },
    todos: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Greedy Placement by Priority
// ---------------------------------------------------------------------------

describe("Greedy Placement by Priority", () => {
  it("schedules all pomodoros of a P0 todo before a P1 todo", () => {
    const day: Day = {
      template: { busy: [], sleep: [{ id: "s1", start: 0, end: 480 }] }, // free from 480 (08:00)
      items: [],
    };

    const todos: Todo[] = [
      {
        _tag: "todo",
        id: "t-p1",
        title: "P1 Task",
        pomodoros: 2,
        priority: "P1",
      },
      {
        _tag: "todo",
        id: "t-p0",
        title: "P0 Task",
        pomodoros: 2,
        priority: "P0",
      },
    ];

    const todoProgress: TodoProgress[] = todos.map((t) => ({
      todo: t,
      remainingPomodoros: t.pomodoros,
    }));

    const { daySchedule } = computeDaySchedule(
      day,
      todoProgress,
      defaultSettings,
      "monday",
    );

    const workSegments = daySchedule.segments.filter((s) => s._tag === "work");

    expect(workSegments).toHaveLength(4);
    // First two work segments belong to P0
    expect(workSegments[0].todoId).toBe("t-p0");
    expect(workSegments[1].todoId).toBe("t-p0");
    // Next two work segments belong to P1
    expect(workSegments[2].todoId).toBe("t-p1");
    expect(workSegments[3].todoId).toBe("t-p1");
  });
});

// ---------------------------------------------------------------------------
// 3. Work/Break Lengths & Long Break Cadence
// ---------------------------------------------------------------------------

describe("Work/Break Lengths & Long Break Cadence", () => {
  it("honors custom work and short break lengths", () => {
    const customSettings: Settings = {
      ...defaultSettings,
      workLength: 50,
      breakLength: 10,
    };

    const day: Day = {
      template: { busy: [], sleep: [{ id: "s1", start: 0, end: 480 }] }, // free at 480
      items: [],
    };

    const todos: Todo[] = [
      { _tag: "todo", id: "t1", title: "Task 1", pomodoros: 1, priority: "P0" },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todos.map((t) => ({ todo: t, remainingPomodoros: t.pomodoros })),
      customSettings,
      "monday",
    );

    expect(daySchedule.segments).toHaveLength(2);
    expect(daySchedule.segments[0]).toMatchObject({
      _tag: "work",
      start: 480,
      end: 530, // 50 mins
    });
    expect(daySchedule.segments[1]).toMatchObject({
      _tag: "break",
      breakType: "short",
      start: 530,
      end: 540, // 10 mins
    });
  });

  it("schedules a long break after every 4th pomodoro on a day", () => {
    const day: Day = {
      template: { busy: [], sleep: [{ id: "s1", start: 0, end: 480 }] }, // free at 480
      items: [],
    };

    const todos: Todo[] = [
      {
        _tag: "todo",
        id: "t1",
        title: "Big Task",
        pomodoros: 5,
        priority: "P0",
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todos.map((t) => ({ todo: t, remainingPomodoros: t.pomodoros })),
      defaultSettings,
      "monday",
    );

    const breaks = daySchedule.segments.filter((s) => s._tag === "break");

    // 5 pomodoros -> 5 breaks (or 4 breaks between + 1 trailing break)
    expect(breaks).toHaveLength(5);
    // Breaks 1, 2, 3 should be short
    expect(breaks[0].breakType).toBe("short");
    expect(breaks[1].breakType).toBe("short");
    expect(breaks[2].breakType).toBe("short");
    // Break 4 (after 4th pomodoro) should be long!
    expect(breaks[3]).toMatchObject({
      breakType: "long",
      end: breaks[3].start + defaultSettings.longBreakLength,
    });
    // Break 5 should be short again
    expect(breaks[4].breakType).toBe("short");
  });

  it("honors a custom long break length after the 4th pomodoro", () => {
    const customSettings: Settings = {
      ...defaultSettings,
      longBreakLength: 60,
    };

    const day: Day = {
      template: { busy: [], sleep: [{ id: "s1", start: 0, end: 480 }] }, // free at 480
      items: [],
    };

    const todos: Todo[] = [
      {
        _tag: "todo",
        id: "t1",
        title: "Big Task",
        pomodoros: 5,
        priority: "P0",
      },
    ];

    const { daySchedule } = computeDaySchedule(
      day,
      todos.map((t) => ({ todo: t, remainingPomodoros: t.pomodoros })),
      customSettings,
      "monday",
    );

    const breaks = daySchedule.segments.filter((s) => s._tag === "break");
    // Break 4 (after the 4th pomodoro) is the long one, and uses the custom length.
    expect(breaks).toHaveLength(5);
    expect(breaks[0].breakType).toBe("short");
    expect(breaks[1].breakType).toBe("short");
    expect(breaks[2].breakType).toBe("short");
    expect(breaks[3]).toMatchObject({
      breakType: "long",
      end: breaks[3].start + 60, // 60 mins, not the default 30
    });
    expect(breaks[4].breakType).toBe("short");
    // Short breaks still use the default 5-minute length
    expect(breaks[0]).toMatchObject({
      end: breaks[0].start + defaultSettings.breakLength,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Mini-Focus
// ---------------------------------------------------------------------------

describe("Mini-Focus Behavior", () => {
  it("fills sub-work-length gap with a 0.5 pomodoro mini-focus when enabled", () => {
    // Gap of 20 mins between busy blocks (workLength = 25, miniFocusLength = 12.5)
    const day: Day = {
      template: { busy: [], sleep: [] },
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Class 1",
          day: "monday",
          start: 0,
          end: 500,
        },
        {
          _tag: "busy",
          id: "b2",
          title: "Class 2",
          day: "monday",
          start: 520,
          end: 1440,
        },
      ], // free span: [500, 520] (20 mins)
    };

    const todos: Todo[] = [
      { _tag: "todo", id: "t1", title: "Paper", pomodoros: 1, priority: "P0" },
    ];

    const { daySchedule, updatedTodos } = computeDaySchedule(
      day,
      todos.map((t) => ({ todo: t, remainingPomodoros: t.pomodoros })),
      { ...defaultSettings, miniFocus: true },
      "monday",
    );

    const workSegments = daySchedule.segments.filter((s) => s._tag === "work");
    expect(workSegments).toHaveLength(1);
    expect(workSegments[0]).toMatchObject({
      _tag: "work",
      isMiniFocus: true,
      count: 0.5,
      start: 500,
      end: 512.5, // 12.5 mins
    });

    // 0.5 pomodoro consumed, 0.5 remaining
    expect(updatedTodos[0].remainingPomodoros).toBe(0.5);
  });

  it("does NOT fill sub-work-length gap when miniFocus is disabled", () => {
    const day: Day = {
      template: { busy: [], sleep: [] },
      items: [
        {
          _tag: "busy",
          id: "b1",
          title: "Class 1",
          day: "monday",
          start: 0,
          end: 500,
        },
        {
          _tag: "busy",
          id: "b2",
          title: "Class 2",
          day: "monday",
          start: 520,
          end: 1440,
        },
      ], // free span: [500, 520] (20 mins)
    };

    const todos: Todo[] = [
      { _tag: "todo", id: "t1", title: "Paper", pomodoros: 1, priority: "P0" },
    ];

    const { daySchedule, updatedTodos } = computeDaySchedule(
      day,
      todos.map((t) => ({ todo: t, remainingPomodoros: t.pomodoros })),
      { ...defaultSettings, miniFocus: false },
      "monday",
    );

    expect(daySchedule.segments).toHaveLength(0);
    expect(updatedTodos[0].remainingPomodoros).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Due Dates & Week Multi-Day Schedule
// ---------------------------------------------------------------------------

describe("Due Dates & Week Schedule", () => {
  it("does not schedule a todo after its due date", () => {
    const busyDay = (d: (typeof WEEKDAY_NAMES)[number]): Day => ({
      template: { busy: [], sleep: [] },
      items: [
        {
          _tag: "busy",
          id: `b1-${d}`,
          title: "Busy Morning",
          day: d,
          start: 0,
          end: 720,
        },
        {
          _tag: "busy",
          id: `b2-${d}`,
          title: "Busy Afternoon",
          day: d,
          start: 780,
          end: 1440,
        },
      ],
    });

    const baseDoc = createSampleDoc();
    const doc: CalendarDoc = {
      ...baseDoc,
      todos: [
        {
          _tag: "todo",
          id: "t-due-tue",
          title: "Tuesday Due Task",
          pomodoros: 5,
          dueDate: "tuesday",
          priority: "P0",
        },
      ],
      days: {
        monday: busyDay("monday"),
        tuesday: busyDay("tuesday"),
        wednesday: busyDay("wednesday"),
        thursday: busyDay("thursday"),
        friday: busyDay("friday"),
        saturday: busyDay("saturday"),
        sunday: busyDay("sunday"),
      },
    };

    const weekSchedule = computeSchedule(doc);

    // Monday gets 2 pomodoros (50m work + 10m break = 60m)
    const monWork = weekSchedule.monday.segments.filter(
      (s) => s._tag === "work",
    );
    expect(monWork).toHaveLength(2);

    // Tuesday gets 2 pomodoros (50m work + 10m break = 60m)
    const tueWork = weekSchedule.tuesday.segments.filter(
      (s) => s._tag === "work",
    );
    expect(tueWork).toHaveLength(2);

    // Wednesday gets 0 pomodoros because dueDate was Tuesday!
    const wedWork = weekSchedule.wednesday.segments.filter(
      (s) => s._tag === "work",
    );
    expect(wedWork).toHaveLength(0);
  });

  it("recomputing one day leaves preceding days' outputs unchanged", () => {
    const baseDoc = createSampleDoc();
    const doc1: CalendarDoc = {
      ...baseDoc,
      todos: [
        {
          _tag: "todo",
          id: "t1",
          title: "Task",
          pomodoros: 10,
          priority: "P0",
        },
      ],
    };

    const sched1 = computeSchedule(doc1);

    // Modify Wednesday on doc2 (add a busy block on Wednesday)
    const doc2: CalendarDoc = {
      ...doc1,
      days: {
        ...doc1.days,
        wednesday: {
          template: { busy: [], sleep: [] },
          items: [
            {
              _tag: "busy",
              id: "b-wed",
              title: "Class",
              day: "wednesday",
              start: 600,
              end: 900,
            },
          ],
        },
      },
    };

    const sched2 = computeSchedule(doc2);

    // Monday and Tuesday outputs MUST be identical
    expect(sched1.monday).toEqual(sched2.monday);
    expect(sched1.tuesday).toEqual(sched2.tuesday);

    // Wednesday outputs should differ
    expect(sched1.wednesday).not.toEqual(sched2.wednesday);
  });
});

// ---------------------------------------------------------------------------
// 6. T7 — Due Dates & Morning-First Spill
// ---------------------------------------------------------------------------

/**
 * A day whose only free time is `[start, start + 30]` — one pomodoro under
 * the default settings (25 min work + 5 min break). The `+ 30` is coupled to
 * `defaultSettings`; change those lengths and this fixture no longer means
 * "one pomodoro".
 */
function narrowDay(
  dayName: (typeof WEEKDAY_NAMES)[number],
  start: number,
): Day {
  return {
    template: {
      busy: [],
      sleep: [{ id: `s-${dayName}`, start: 0, end: start }],
    },
    items: [
      {
        _tag: "busy",
        id: `b-${dayName}`,
        title: "Busy",
        day: dayName,
        start: start + 30,
        end: 1440,
      },
    ],
  };
}

/** A week whose days all have the given days (default: empty), in storage order. */
function narrowWeek(
  days: Partial<Record<(typeof WEEKDAY_NAMES)[number], Day>> = {},
): CalendarDoc["days"] {
  const week = {} as Record<(typeof WEEKDAY_NAMES)[number], Day>;
  for (const dayName of WEEKDAY_NAMES) {
    week[dayName] = days[dayName] ?? createEmptyDay();
  }
  return week;
}

/** Work segments scheduled on one day. */
function workSegments(
  week: ReturnType<typeof computeSchedule>,
  day: (typeof WEEKDAY_NAMES)[number],
): WorkSegment[] {
  return week[day].segments.filter((s): s is WorkSegment => s._tag === "work");
}

describe("Due Dates & Morning-First Spill (T7)", () => {
  it("never schedules a due-dated todo past its due date, even if it means leaving work undone", () => {
    const baseDoc = createSampleDoc();
    const doc: CalendarDoc = {
      ...baseDoc,
      todos: [
        {
          _tag: "todo",
          id: "t-due",
          title: "Due Tuesday",
          pomodoros: 3,
          dueDate: "tuesday",
          priority: "P0",
        },
      ],
      days: narrowWeek({
        monday: narrowDay("monday", 0),
        tuesday: narrowDay("tuesday", 480),
      }),
    };

    const week = computeSchedule(doc);

    // 1 pomodoro each on Monday and Tuesday (the due date), leftover dropped.
    expect(workSegments(week, "monday")).toHaveLength(1);
    expect(workSegments(week, "tuesday")).toHaveLength(1);
    expect(workSegments(week, "wednesday")).toHaveLength(0);
  });

  it("spills overflow to the next day morning-first", () => {
    const baseDoc = createSampleDoc();
    const doc: CalendarDoc = {
      ...baseDoc,
      todos: [
        {
          _tag: "todo",
          id: "t-a",
          title: "Overflow Task",
          pomodoros: 2,
          priority: "P0",
        },
      ],
      days: narrowWeek({
        monday: narrowDay("monday", 0),
        tuesday: {
          template: { busy: [], sleep: [{ id: "s", start: 0, end: 480 }] },
          items: [],
        },
      }),
    };

    const week = computeSchedule(doc);

    expect(workSegments(week, "monday")).toHaveLength(1);
    expect(workSegments(week, "tuesday")).toHaveLength(1);
    // The spill lands in Tuesday's earliest free slot (08:00, the morning).
    expect(workSegments(week, "tuesday")[0]).toMatchObject({
      todoId: "t-a",
      start: 480,
    });
  });

  it("re-sorts a spill against the next day's priorities, displacing strictly-lower-priority work", () => {
    const baseDoc = createSampleDoc();
    const doc: CalendarDoc = {
      ...baseDoc,
      todos: [
        {
          _tag: "todo",
          id: "t-p0",
          title: "P0 Spill",
          pomodoros: 2,
          priority: "P0",
        },
        {
          _tag: "todo",
          id: "t-p1",
          title: "P1 Native",
          pomodoros: 1,
          priority: "P1",
        },
      ],
      days: narrowWeek({
        monday: narrowDay("monday", 0),
        tuesday: narrowDay("tuesday", 480),
      }),
    };

    const week = computeSchedule(doc);

    // Monday: P0 spill candidate takes the only slot (it was first by priority).
    // Tuesday: the carried P0 still outranks the native P1 and takes the slot.
    expect(workSegments(week, "tuesday")).toHaveLength(1);
    expect(workSegments(week, "tuesday")[0].todoId).toBe("t-p0");

    // The displaced P1 spills onward to Wednesday.
    expect(workSegments(week, "wednesday")).toHaveLength(1);
    expect(workSegments(week, "wednesday")[0].todoId).toBe("t-p1");
  });

  it("does not let a spill displace same-priority work already planned (P0 never bumps P0)", () => {
    const baseDoc = createSampleDoc();
    const doc: CalendarDoc = {
      ...baseDoc,
      todos: [
        { _tag: "todo", id: "t-a", title: "A", pomodoros: 2, priority: "P0" },
        { _tag: "todo", id: "t-b", title: "B", pomodoros: 1, priority: "P0" },
      ],
      days: narrowWeek({
        monday: narrowDay("monday", 0),
        tuesday: narrowDay("tuesday", 480),
      }),
    };

    const week = computeSchedule(doc);

    // Monday: only one slot — A (first in doc order among fresh P0s) takes it.
    // Tuesday: B is still fresh (never started), A is a carried spill. B stays put.
    expect(workSegments(week, "tuesday")).toHaveLength(1);
    expect(workSegments(week, "tuesday")[0].todoId).toBe("t-b");

    // A's leftover re-spills to Wednesday instead of bumping B.
    expect(workSegments(week, "wednesday")).toHaveLength(1);
    expect(workSegments(week, "wednesday")[0].todoId).toBe("t-a");
  });

  it("touches only affected days when a day's free time changes", () => {
    const baseDoc = createSampleDoc();
    const doc1: CalendarDoc = {
      ...baseDoc,
      todos: [
        {
          _tag: "todo",
          id: "t-a",
          title: "Task",
          pomodoros: 8,
          priority: "P0",
        },
      ],
      days: narrowWeek({
        monday: narrowDay("monday", 0),
        tuesday: narrowDay("tuesday", 480),
        wednesday: narrowDay("wednesday", 480),
        thursday: narrowDay("thursday", 480),
        friday: narrowDay("friday", 480),
        saturday: narrowDay("saturday", 480),
        sunday: narrowDay("sunday", 480),
      }),
    };

    const sched1 = computeSchedule(doc1);

    // Shrink Tuesday to zero free time: busy across the whole day.
    const doc2: CalendarDoc = {
      ...doc1,
      days: {
        ...doc1.days,
        tuesday: {
          template: { busy: [], sleep: [{ id: "s-tue", start: 0, end: 1440 }] },
          items: [],
        },
      },
    };

    const sched2 = computeSchedule(doc2);

    // Preceding days are untouched.
    expect(sched2.monday).toEqual(sched1.monday);

    // The edited day and a downstream spill day change.
    expect(sched2.tuesday).not.toEqual(sched1.tuesday);
    expect(sched2.friday).not.toEqual(sched1.friday);
  });

  it("recomputing a day with a spill re-sorts that day but leaves preceding days untouched", () => {
    const baseDoc = createSampleDoc();
    const makeDoc = (wednesday: Day): CalendarDoc => ({
      ...baseDoc,
      todos: [
        { _tag: "todo", id: "t-a", title: "P0", pomodoros: 2, priority: "P0" },
        { _tag: "todo", id: "t-b", title: "P1", pomodoros: 1, priority: "P1" },
      ],
      days: narrowWeek({
        monday: narrowDay("monday", 0),
        tuesday: narrowDay("tuesday", 480),
        wednesday,
        thursday: narrowDay("thursday", 480),
        friday: narrowDay("friday", 480),
        saturday: narrowDay("saturday", 480),
        sunday: narrowDay("sunday", 480),
      }),
    });

    // B (P1) is displaced off Monday/Tuesday by the P0 spill; it lands Wednesday.
    const sched1 = computeSchedule(makeDoc(narrowDay("wednesday", 480)));

    // Wednesday loses its free slot: B re-spills onward to Thursday.
    const sched2 = computeSchedule(
      makeDoc({
        template: { busy: [], sleep: [{ id: "s-wed", start: 0, end: 1440 }] },
        items: [],
      }),
    );

    // Monday and Tuesday (the spill's origin and re-sort day) are untouched.
    expect(sched2.monday).toEqual(sched1.monday);
    expect(sched2.tuesday).toEqual(sched1.tuesday);

    // The edited day changes and B re-spills to the next free day.
    expect(sched2.wednesday).not.toEqual(sched1.wednesday);
    expect(workSegments(sched1, "thursday")).toHaveLength(0);
    expect(workSegments(sched2, "thursday")[0].todoId).toBe("t-b");
  });
});

// ---------------------------------------------------------------------------
// 7. Determinism
// ---------------------------------------------------------------------------

describe("Determinism", () => {
  it("produces identical output given identical inputs", () => {
    const baseDoc = createSampleDoc();
    const doc: CalendarDoc = {
      ...baseDoc,
      todos: [
        { _tag: "todo", id: "t1", title: "A", pomodoros: 3, priority: "P0" },
        { _tag: "todo", id: "t2", title: "B", pomodoros: 2, priority: "P2" },
      ],
    };

    const run1 = computeSchedule(doc);
    const run2 = computeSchedule(doc);

    expect(run1).toEqual(run2);
  });
});
