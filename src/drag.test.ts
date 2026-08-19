/**
 * Drag & drop glue unit tests (T10, adjusted moves — #19).
 *
 * Covers the commit seam every drop target uses: an adjusted drop moves the
 * item to a resolved placement and persists it, a refused drop leaves the
 * document untouched (item returns to its origin), and todo drops set the due
 * date.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarStore } from "./state";
import { makeMemoryStorageLayer } from "./storage";
import {
  adjustedDropMessage,
  commitDropOnDay,
  commitDropOnDayWithPreview,
  previewDragOverDay,
  previewDropOnDay,
} from "./drag";
import { type Busy, type Event as CalendarEvent, type Sleep, type Todo } from "./schema";

const busy: Busy = {
  _tag: "busy",
  id: "busy-1",
  title: "Calculus Lecture",
  day: "monday",
  start: 540,
  end: 600,
};

describe("commitDropOnDay (day items)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("moves an item to a clear column, preserving its wall-clock span", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);

    const result = commitDropOnDay(
      store,
      { kind: "day-item", item: busy },
      "wednesday",
    );

    expect(result).toEqual({ ok: true });
    expect(store.doc.days.monday.items).toHaveLength(0);
    expect(store.doc.days.wednesday.items).toHaveLength(1);
    expect(store.doc.days.wednesday.items[0]).toMatchObject({
      id: "busy-1",
      day: "wednesday",
      start: 540,
      end: 600,
    });
  });

  it("shortens an item from its requested start when it collides", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    store.addTemplateBusy("tuesday", {
      id: "tb1",
      title: "Class",
      start: 540,
      end: 570,
    });

    const { preview, result } = commitDropOnDayWithPreview(
      store,
      { kind: "day-item", item: busy },
      "tuesday",
    );

    expect(result).toEqual({ ok: true });
    expect(adjustedDropMessage(preview)).toBe("Adjusted: placed at Tue 09:30–10:00");
    expect(store.doc.days.tuesday.items[0]).toMatchObject({
      id: "busy-1",
      day: "tuesday",
      start: 570,
      end: 600,
    });
  });

  it("adjusts to the nearest alternate start when shortening can't keep 15min", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    store.addBusy("tuesday", {
      _tag: "busy",
      id: "busy-2",
      title: "Work Shift",
      day: "tuesday",
      start: 540,
      end: 600,
    });

    const result = commitDropOnDay(
      store,
      { kind: "day-item", item: busy },
      "tuesday",
    );

    // [540,600] is fully occupied; the nearest 60-min gap is [600,660]
    // (tie with [480,540], later candidate wins).
    expect(result).toEqual({ ok: true });
    expect(store.doc.days.tuesday.items).toHaveLength(2);
    expect(store.doc.days.tuesday.items[1]).toMatchObject({
      id: "busy-1",
      day: "tuesday",
      start: 600,
      end: 660,
    });
  });

  it("refuses a drop with no valid placement and leaves the origin unchanged", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    store.addBusy("tuesday", {
      _tag: "busy",
      id: "wall",
      title: "Full Day",
      day: "tuesday",
      start: 0,
      end: 1440,
    });

    const result = commitDropOnDay(
      store,
      { kind: "day-item", item: busy },
      "tuesday",
    );

    expect(result).toEqual({ ok: false, reason: expect.stringContaining("refused") });
    // Item stays exactly where it started, with its prior span intact.
    expect(store.doc.days.monday.items).toHaveLength(1);
    expect(store.doc.days.monday.items[0]).toEqual(busy);
    expect(store.doc.days.tuesday.items).toHaveLength(1);
  });

  it("does not treat the item itself as a collision when moving within its day", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);

    const result = commitDropOnDay(
      store,
      { kind: "day-item", item: busy },
      "monday",
    );

    expect(result).toEqual({ ok: true });
    expect(store.doc.days.monday.items[0]).toEqual(busy);
  });

  it("adjusts a sleep drop that overlaps a template block", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addTemplateBusy("monday", {
      id: "tb1",
      title: "Class",
      start: 480,
      end: 720,
    });

    const sleep = {
      _tag: "sleep" as const,
      id: "s1",
      day: "tuesday" as const,
      start: 540,
      end: 660,
    };
    store.addSleep("tuesday", sleep);
    const result = commitDropOnDay(
      store,
      { kind: "day-item", item: sleep },
      "monday",
    );

    // [480,720] is occupied; the nearest 120-min gap is [720,840]
    // (tie with [360,480], later candidate wins).
    expect(result).toEqual({ ok: true });
    expect(store.doc.days.monday.items[0]).toMatchObject({
      id: "s1",
      day: "monday",
      start: 720,
      end: 840,
    });
    expect(store.doc.days.tuesday.items).toHaveLength(0);
  });

  it("moves an Event through the strip seam without changing its wall-clock span", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    const event: CalendarEvent = {
      _tag: "event",
      id: "event-1",
      title: "Dentist",
      day: "monday",
      start: 600,
      end: 690,
    };
    store.addEvent("monday", event);

    expect(commitDropOnDay(store, { kind: "day-item", item: event }, "thursday")).toEqual({
      ok: true,
    });
    expect(store.doc.days.thursday.items[0]).toMatchObject({
      id: "event-1",
      day: "thursday",
      start: 600,
      end: 690,
    });
  });

  it("moves Sleep through the strip seam without changing its wall-clock span", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    const sleep: Sleep = {
      _tag: "sleep",
      id: "sleep-1",
      day: "monday",
      start: 1380,
      end: 420,
    };
    store.addSleep("monday", sleep);

    expect(commitDropOnDay(store, { kind: "day-item", item: sleep }, "thursday")).toEqual({
      ok: true,
    });
    expect(store.doc.days.thursday.items[0]).toMatchObject({
      id: "sleep-1",
      day: "thursday",
      start: 1380,
      end: 420,
    });
  });

  it("persists an adjusted move and it survives a reload", async () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
    await store.load();
    store.addBusy("monday", busy);
    store.addBusy("tuesday", {
      _tag: "busy",
      id: "busy-2",
      title: "Work Shift",
      day: "tuesday",
      start: 540,
      end: 600,
    });

    const result = commitDropOnDay(
      store,
      { kind: "day-item", item: busy },
      "tuesday",
    );
    expect(result).toEqual({ ok: true });

    vi.advanceTimersByTime(50);

    // Reload from the same storage layer as a fresh store.
    const reloaded = createCalendarStore(memoryLayer);
    await reloaded.load();
    const moved = reloaded.doc.days.tuesday.items.find((i) => i.id === "busy-1");
    expect(moved).toMatchObject({ day: "tuesday", start: 600, end: 660 });
    expect(reloaded.doc.days.monday.items).toHaveLength(0);
  });
});

describe("commitDropOnDay (todos)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const todo: Todo = {
    _tag: "todo",
    id: "todo-1",
    title: "Essay",
    pomodoros: 2,
    priority: "P1",
  };

  it("sets the due date from a drag onto a day", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addTodo(todo);

    const result = commitDropOnDay(store, { kind: "todo", item: todo }, "friday");

    expect(result).toEqual({ ok: true });
    expect(store.doc.todos[0].dueDate).toBe("friday");
  });

  it("is a no-op when the due date already matches", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addTodo({ ...todo, dueDate: "monday" });

    commitDropOnDay(store, { kind: "todo", item: { ...todo, dueDate: "monday" } }, "monday");

    expect(store.doc.todos[0].dueDate).toBe("monday");
  });

  it("reports that a todo changes only its due Week day", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addTodo(todo);

    expect(previewDropOnDay(store, { kind: "todo", item: todo }, "friday")).toEqual({
      kind: "todo",
      targetDay: "friday",
      accepted: true,
      dueDateChanged: true,
    });

    commitDropOnDay(store, { kind: "todo", item: todo }, "friday");

    expect(store.doc.todos[0]).toMatchObject(todo);
    expect(store.doc.todos[0].dueDate).toBe("friday");
    expect(Object.values(store.doc.days).every((day) => day.items.length === 0)).toBe(true);
  });

  it("persists a dragged Todo due Week day", async () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
    await store.load();
    store.addTodo(todo);

    expect(commitDropOnDay(store, { kind: "todo", item: todo }, "friday")).toEqual({ ok: true });
    vi.advanceTimersByTime(50);

    const reloaded = createCalendarStore(memoryLayer);
    await reloaded.load();
    expect(reloaded.doc.todos[0]).toMatchObject({ id: "todo-1", dueDate: "friday" });
    expect(Object.values(reloaded.doc.days).every((day) => day.items.length === 0)).toBe(true);
  });
});

describe("previewDropOnDay", () => {
  it("previews an adjusted Day item strip drop", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    store.addBusy("tuesday", {
      _tag: "busy",
      id: "busy-2",
      title: "Work Shift",
      day: "tuesday",
      start: 540,
      end: 600,
    });

    expect(previewDropOnDay(store, { kind: "day-item", item: busy }, "tuesday")).toEqual({
      kind: "day-item",
      targetDay: "tuesday",
      accepted: true,
      start: 600,
      end: 660,
      adjusted: true,
    });
  });

  it("previews refusal without changing the source", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    store.addBusy("tuesday", {
      _tag: "busy",
      id: "wall",
      title: "Full Day",
      day: "tuesday",
      start: 0,
      end: 1440,
    });

    expect(previewDropOnDay(store, { kind: "day-item", item: busy }, "tuesday")).toEqual({
      kind: "day-item",
      targetDay: "tuesday",
      accepted: false,
      reason: expect.stringContaining("No 15-minute placement"),
    });
    expect(store.doc.days.monday.items).toEqual([busy]);
  });
});

describe("previewDragOverDay", () => {
  function dragEventFor(payload: object) {
    const dataTransfer = {
      getData: (_format: string) => JSON.stringify(payload),
      dropEffect: "none" as DataTransfer["dropEffect"],
    };
    return {
      dataTransfer,
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
  }

  it("prevents the native default and advertises a valid move", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    const event = dragEventFor({ kind: "day-item", item: busy });

    expect(previewDragOverDay(event, store, "wednesday")).toMatchObject({
      accepted: true,
      targetDay: "wednesday",
    });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.dataTransfer?.dropEffect).toBe("move");
  });

  it("advertises refusal for a full target Week day", async () => {
    const store = createCalendarStore(makeMemoryStorageLayer());
    await store.load();
    store.addBusy("monday", busy);
    store.addBusy("tuesday", {
      _tag: "busy",
      id: "wall",
      title: "Full Day",
      day: "tuesday",
      start: 0,
      end: 1440,
    });
    const event = dragEventFor({ kind: "day-item", item: busy });

    expect(previewDragOverDay(event, store, "tuesday")).toMatchObject({
      accepted: false,
      targetDay: "tuesday",
    });
    expect(event.dataTransfer?.dropEffect).toBe("none");
  });
});
