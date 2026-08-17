/**
 * Drag & drop glue unit tests (T10).
 *
 * Covers the commit seam every drop target uses: a refused drop leaves the
 * document untouched (item returns to its origin), a clean drop moves the
 * item to the target day/time, and todo drops set the due date.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarStore } from "./state";
import { makeMemoryStorageLayer } from "./storage";
import { commitDropOnDay } from "./drag";
import { type Busy, type Todo } from "./schema";

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

  it("moves an item to a clear column at its current time", async () => {
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

  it("refuses an overlapping drop and leaves the origin untouched", async () => {
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

    expect(result).toEqual({ ok: false, reason: expect.stringContaining("refused") });
    // Item stays exactly where it started.
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

  it("refuses a sleep drop overlapping a template block", async () => {
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

    expect(result).toEqual({ ok: false, reason: expect.stringContaining("refused") });
    expect(store.doc.days.tuesday.items).toHaveLength(1);
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
});
