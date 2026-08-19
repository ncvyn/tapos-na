/**
 * Derived Pomodoro Bands UI & State integration tests (T5).
 *
 * Verifies that:
 * 1. Day and week schedules render work and break bands correctly in free time gaps.
 * 2. Input changes (busy blocks, sleep, events, todos, settings) update bands reactively.
 * 3. Recomputing an affected day updates that day while preserving unchanged days.
 * 4. Pomodoro bands are read-only derived state and stay absent from stored CalendarDoc.
 */

import { describe, expect, it } from "vitest";
import { computeSchedule } from "./engine";
import { createCalendarStore } from "./state";
import { makeMemoryStorageLayer } from "./storage";
import {
  type Busy,
  type Event as CalendarEvent,
  type Sleep,
  type Todo,
} from "./schema";

describe("Derived Pomodoro Bands Integration (T5)", () => {
  it("computes work and break bands in free gaps between fixed user items", () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer);

    // Sleep 23:00 - 07:00 (1380 - 420)
    const sleepItem: Sleep = {
      _tag: "sleep",
      id: "sl-1",
      day: "monday",
      start: 1380,
      end: 420,
    };
    store.addSleep("monday", sleepItem);

    // Busy block 12:00 - 13:00 (720 - 780)
    const busyItem: Busy = {
      _tag: "busy",
      id: "bu-1",
      title: "Lunch Meeting",
      day: "monday",
      start: 720,
      end: 780,
    };
    store.addBusy("monday", busyItem);

    // Todo needing 2 pomodoros
    const todo: Todo = {
      _tag: "todo",
      id: "td-1",
      title: "Write Report",
      pomodoros: 2,
      priority: "P0",
    };
    store.addTodo(todo);

    const schedule = computeSchedule(store.doc);
    const monSegments = schedule.monday.segments;

    // Free time before lunch: 07:00 (420) to 12:00 (720)
    // Pomodoro 1: work 420-445, break 445-450
    // Pomodoro 2: work 450-475, break 475-480
    expect(monSegments.length).toBeGreaterThanOrEqual(4);

    const work1 = monSegments[0];
    expect(work1).toMatchObject({
      _tag: "work",
      todoId: "td-1",
      todoTitle: "Write Report",
      priority: "P0",
      start: 420,
      end: 445,
      pomodoroNumber: 1,
    });

    const break1 = monSegments[1];
    expect(break1).toMatchObject({
      _tag: "break",
      breakType: "short",
      start: 445,
      end: 450,
    });

    const work2 = monSegments[2];
    expect(work2).toMatchObject({
      _tag: "work",
      todoId: "td-1",
      todoTitle: "Write Report",
      priority: "P0",
      start: 450,
      end: 475,
      pomodoroNumber: 2,
    });

    const break2 = monSegments[3];
    expect(break2).toMatchObject({
      _tag: "break",
      breakType: "short",
      start: 475,
      end: 480,
    });
  });

  it("recomputes bands reactively when a busy block is added, covering free gaps without overlapping", () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer);

    const todo: Todo = {
      _tag: "todo",
      id: "td-1",
      title: "Study",
      pomodoros: 3,
      priority: "P1",
    };
    store.addTodo(todo);

    let schedule = computeSchedule(store.doc);
    const initialMondayWorkCount = schedule.monday.segments.filter(
      (s) => s._tag === "work",
    ).length;
    expect(initialMondayWorkCount).toBe(3);

    // Add a busy block that covers all afternoon on Monday: 12:00 - 24:00 (720 - 1440)
    const afternoonBusy: Busy = {
      _tag: "busy",
      id: "bu-afternoon",
      title: "Shift",
      day: "monday",
      start: 720,
      end: 1440,
    };
    store.addBusy("monday", afternoonBusy);

    schedule = computeSchedule(store.doc);

    // Ensure no work or break segment overlaps with the busy block [720, 1440]
    for (const seg of schedule.monday.segments) {
      expect(seg.start < 720 || seg.start >= 1440).toBe(true);
      expect(seg.end <= 720 || seg.end > 1440).toBe(true);
    }
  });

  it("ensures pomodoro bands are NEVER stored in CalendarDoc", () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer);

    store.addTodo({
      _tag: "todo",
      id: "td-1",
      title: "Task A",
      pomodoros: 4,
      priority: "P0",
    });

    // Verify store doc keys
    expect(store.doc).not.toHaveProperty("segments");
    expect(store.doc).not.toHaveProperty("bands");
    expect(
      store.doc.days.monday.items.every(
        (item) =>
          (item as any)._tag !== "work" && (item as any)._tag !== "break",
      ),
    ).toBe(true);
  });

  it("recomputes affected day when inputs change, leaving preceding days identical", () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer);

    store.addTodo({
      _tag: "todo",
      id: "td-1",
      title: "Task Long",
      pomodoros: 10,
      priority: "P0",
    });

    const sched1 = computeSchedule(store.doc);

    // Add event on Wednesday
    const wedEvent: CalendarEvent = {
      _tag: "event",
      id: "ev-wed",
      title: "Workshop",
      day: "wednesday",
      start: 600,
      end: 900,
    };
    store.addEvent("wednesday", wedEvent);

    const sched2 = computeSchedule(store.doc);

    // Monday & Tuesday schedules MUST be identical
    expect(sched1.monday).toEqual(sched2.monday);
    expect(sched1.tuesday).toEqual(sched2.tuesday);

    // Wednesday schedule MUST differ due to the event
    expect(sched1.wednesday).not.toEqual(sched2.wednesday);
  });
});
