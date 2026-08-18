import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { createCalendarStore } from "./state";
import { makeMemoryStorageLayer, StorageService } from "./storage";
import {
  type Busy,
  type CalendarDoc,
  type Event as CalendarEvent,
  type Sleep,
  type Todo,
} from "./schema";

describe("state store & actions seam", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("initializes and loads doc from storage", async () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer);
    await store.load();

    expect(store.isLoaded()).toBe(true);
    expect(store.doc.version).toBe(1);
    expect(store.doc.todos).toEqual([]);
  });

  describe("busy block CRUD", () => {
    it("adds a busy block optimistically and persists debounced", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 100 });
      await store.load();

      const newBusy: Busy = {
        _tag: "busy",
        id: "busy-1",
        title: "Calculus Lecture",
        day: "monday",
        start: 540, // 09:00
        end: 600, // 10:00
      };

      store.addBusy("monday", newBusy);

      // Optimistic update check
      expect(store.doc.days.monday.items).toHaveLength(1);
      expect(store.doc.days.monday.items[0]).toEqual(newBusy);

      // Advance timers to trigger debounce
      vi.advanceTimersByTime(100);

      // Check persisted state in storage
      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );

      expect(persistedDoc.days.monday.items).toHaveLength(1);
      expect(persistedDoc.days.monday.items[0]).toEqual(newBusy);
    });

    it("updates and deletes a busy block", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const busy: Busy = {
        _tag: "busy",
        id: "busy-1",
        title: "Calculus Lecture",
        day: "monday",
        start: 540,
        end: 600,
      };
      store.addBusy("monday", busy);

      const updatedBusy: Busy = {
        ...busy,
        title: "Advanced Calculus",
        end: 630,
      };
      store.updateBusy("monday", updatedBusy);
      const updatedItem = store.doc.days.monday.items[0];
      expect(updatedItem._tag).toBe("busy");
      if (updatedItem._tag === "busy") {
        expect(updatedItem.title).toBe("Advanced Calculus");
      }

      store.deleteBusy("monday", "busy-1");
      expect(store.doc.days.monday.items).toHaveLength(0);

      vi.advanceTimersByTime(50);

      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.days.monday.items).toHaveLength(0);
    });
  });

  it("refuses an overlapping block", async () => {
    const memoryLayer = makeMemoryStorageLayer();
    const store = createCalendarStore(memoryLayer);
    await store.load();

    store.addBusy("monday", {
      _tag: "busy",
      id: "busy-1",
      title: "Test 1",
      day: "monday",
      start: 0,
      end: 120,
    });
    store.addEvent("monday", {
      _tag: "event",
      id: "event-1",
      title: "Test 2",
      day: "monday",
      start: 0,
      end: 120,
    });

    expect(store.doc.days.monday.items).toHaveLength(1);
    expect(store.errorMessage()).toContain("overlap");
  });

  describe("event item CRUD", () => {
    it("adds, updates, and deletes event items optimistically", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const event: CalendarEvent = {
        _tag: "event",
        id: "ev-1",
        title: "Dentist Appointment",
        day: "wednesday",
        start: 600, // 10:00
        end: 660, // 11:00
      };

      store.addEvent("wednesday", event);
      expect(store.doc.days.wednesday.items).toHaveLength(1);
      expect(store.doc.days.wednesday.items[0]).toEqual(event);

      const updatedEvent: CalendarEvent = {
        ...event,
        title: "Dentist & Checkup",
        end: 690,
      };
      store.updateEvent("wednesday", updatedEvent);
      const item = store.doc.days.wednesday.items[0];
      expect(item._tag).toBe("event");
      if (item._tag === "event") {
        expect(item.title).toBe("Dentist & Checkup");
      }

      store.deleteEvent("wednesday", "ev-1");
      expect(store.doc.days.wednesday.items).toHaveLength(0);
    });
  });

  describe("sleep item CRUD", () => {
    it("adds, updates, and deletes sleep items optimistically", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const sleep: Sleep = {
        _tag: "sleep",
        id: "sleep-1",
        day: "sunday",
        start: 1380, // 23:00
        end: 420, // 07:00
      };

      store.addSleep("sunday", sleep);
      expect(store.doc.days.sunday.items).toHaveLength(1);
      expect(store.doc.days.sunday.items[0]).toEqual(sleep);

      const updatedSleep: Sleep = {
        ...sleep,
        start: 1320, // 22:00
      };
      store.updateSleep("sunday", updatedSleep);
      expect(store.doc.days.sunday.items[0].start).toBe(1320);

      store.deleteSleep("sunday", "sleep-1");
      expect(store.doc.days.sunday.items).toHaveLength(0);
    });
  });

  describe("day-changing item updates", () => {
    it("moves an item from one day to another if day changes during update", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const busy: Busy = {
        _tag: "busy",
        id: "busy-move-1",
        title: "Lab Session",
        day: "monday",
        start: 540,
        end: 660,
      };

      store.addBusy("monday", busy);
      expect(store.doc.days.monday.items).toHaveLength(1);
      expect(store.doc.days.tuesday.items).toHaveLength(0);

      // Move to Tuesday
      const movedBusy: Busy = {
        ...busy,
        day: "tuesday",
      };
      store.updateBusy("monday", movedBusy);

      expect(store.doc.days.monday.items).toHaveLength(0);
      expect(store.doc.days.tuesday.items).toHaveLength(1);
      expect(store.doc.days.tuesday.items[0].id).toBe("busy-move-1");
    });
  });

  describe("resizeDayItem (adjusted resize seam)", () => {
    it("clamps an extending resize to occupancy and persists debounced", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const busy: Busy = {
        _tag: "busy",
        id: "busy-1",
        title: "Standup",
        day: "monday",
        start: 540,
        end: 600,
      };
      store.addBusy("monday", busy);
      store.addTemplateBusy("monday", {
        id: "tb1",
        title: "Workshop",
        start: 660,
        end: 700,
      });

      // Extending the end to 720 collides with [660,700]; it clamps to 660.
      const saved = store.resizeDayItem("monday", busy, {
        edge: "end",
        value: 720,
      });
      expect(saved).toBe(true);
      expect(store.doc.days.monday.items[0]).toMatchObject({
        id: "busy-1",
        start: 540,
        end: 660,
      });

      vi.advanceTimersByTime(50);
      const reloaded = createCalendarStore(memoryLayer);
      await reloaded.load();
      expect(reloaded.doc.days.monday.items[0]).toMatchObject({
        id: "busy-1",
        start: 540,
        end: 660,
      });
    });

    it("refuses a resize shorter than 15 minutes and leaves the item unchanged", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer);
      await store.load();

      const busy: Busy = {
        _tag: "busy",
        id: "busy-1",
        title: "Standup",
        day: "monday",
        start: 540,
        end: 600,
      };
      store.addBusy("monday", busy);

      const saved = store.resizeDayItem("monday", busy, {
        edge: "end",
        value: 550,
      });
      expect(saved).toBe(false);
      expect(store.errorMessage()).toContain("Resize refused");
      expect(store.doc.days.monday.items[0]).toEqual(busy);
    });

    it("persists a resized wrapping sleep and survives reload", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const sleep: Sleep = {
        _tag: "sleep",
        id: "sleep-1",
        day: "monday",
        start: 1380,
        end: 420,
      };
      store.addSleep("monday", sleep);

      const saved = store.resizeDayItem("monday", sleep, {
        edge: "end",
        value: 300,
      });
      expect(saved).toBe(true);
      expect(store.doc.days.monday.items[0]).toMatchObject({
        id: "sleep-1",
        start: 1380,
        end: 300,
      });

      vi.advanceTimersByTime(50);
      const reloaded = createCalendarStore(memoryLayer);
      await reloaded.load();
      expect(reloaded.doc.days.monday.items[0]).toMatchObject({
        id: "sleep-1",
        start: 1380,
        end: 300,
      });
    });

    it("persists a resized event and survives reload", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const event: CalendarEvent = {
        _tag: "event",
        id: "ev-1",
        title: "Dentist",
        day: "tuesday",
        start: 540,
        end: 600,
      };
      store.addEvent("tuesday", event);

      const saved = store.resizeDayItem("tuesday", event, {
        edge: "end",
        value: 630,
      });
      expect(saved).toBe(true);
      expect(store.doc.days.tuesday.items[0]).toMatchObject({
        id: "ev-1",
        start: 540,
        end: 630,
      });

      vi.advanceTimersByTime(50);
      const reloaded = createCalendarStore(memoryLayer);
      await reloaded.load();
      expect(reloaded.doc.days.tuesday.items[0]).toMatchObject({
        id: "ev-1",
        start: 540,
        end: 630,
      });
    });
  });

  describe("settings updates", () => {
    it("updates settings optimistically and triggers save", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      expect(store.doc.settings.workLength).toBe(25);
      store.updateSettings({ workLength: 30 });

      expect(store.doc.settings.workLength).toBe(30);

      vi.advanceTimersByTime(50);
      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.settings.workLength).toBe(30);
    });

    it("round-trips every settings field (incl. apiKey) through store and storage reload", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      store.updateSettings({
        workLength: 50,
        breakLength: 10,
        longBreakLength: 60,
        miniFocus: false,
        apiKey: "r2-secret-key",
      });

      expect(store.doc.settings).toMatchObject({
        workLength: 50,
        breakLength: 10,
        longBreakLength: 60,
        miniFocus: false,
        apiKey: "r2-secret-key",
      });

      vi.advanceTimersByTime(50);

      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.settings).toMatchObject({
        workLength: 50,
        breakLength: 10,
        longBreakLength: 60,
        miniFocus: false,
        apiKey: "r2-secret-key",
      });
    });
  });

  describe("weekly template CRUD", () => {
    it("adds, updates, and deletes template busy blocks", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      store.addTemplateBusy("monday", {
        id: "tb-1",
        title: "Math Lecture",
        start: 540,
        end: 600,
      });
      expect(store.doc.days.monday.template.busy).toHaveLength(1);
      expect(store.doc.days.monday.template.busy[0].title).toBe("Math Lecture");

      store.updateTemplateBusy("monday", {
        id: "tb-1",
        title: "Advanced Math",
        start: 540,
        end: 630,
      });
      expect(store.doc.days.monday.template.busy[0]).toMatchObject({
        title: "Advanced Math",
        end: 630,
      });

      store.deleteTemplateBusy("monday", "tb-1");
      expect(store.doc.days.monday.template.busy).toHaveLength(0);

      vi.advanceTimersByTime(50);
      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.days.monday.template.busy).toHaveLength(0);
    });

    it("adds, updates, and deletes template sleep windows (incl. cross-midnight)", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      store.addTemplateSleep("tuesday", { id: "ts-1", start: 1380, end: 420 });
      expect(store.doc.days.tuesday.template.sleep).toHaveLength(1);
      expect(store.doc.days.tuesday.template.sleep[0]).toMatchObject({
        start: 1380,
        end: 420,
      });

      store.updateTemplateSleep("tuesday", { id: "ts-1", start: 1320, end: 480 });
      expect(store.doc.days.tuesday.template.sleep[0].start).toBe(1320);

      store.deleteTemplateSleep("tuesday", "ts-1");
      expect(store.doc.days.tuesday.template.sleep).toHaveLength(0);
    });

    it("template busy and sleep stay on their own day (no cross-day leakage)", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer);
      await store.load();

      store.addTemplateBusy("monday", {
        id: "tb-1",
        title: "Class",
        start: 540,
        end: 600,
      });
      store.addTemplateSleep("monday", { id: "ts-1", start: 1380, end: 420 });

      expect(store.doc.days.monday.template.busy).toHaveLength(1);
      expect(store.doc.days.tuesday.template.busy).toHaveLength(0);
      expect(store.doc.days.tuesday.template.sleep).toHaveLength(0);
    });
  });

  describe("sleep override", () => {
    it("sets a one-off sleep override for one day, leaving other days' template sleep intact", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      store.addTemplateSleep("monday", { id: "ts-1", start: 1380, end: 420 });
      store.addTemplateSleep("tuesday", { id: "ts-2", start: 1380, end: 420 });

      store.setSleepOverride("monday", [{ start: 60, end: 540 }]);

      expect(store.doc.days.monday.sleepOverride).toEqual([
        { start: 60, end: 540 },
      ]);
      // Template sleep untouched, and other days untouched
      expect(store.doc.days.monday.template.sleep).toHaveLength(1);
      expect(store.doc.days.tuesday.sleepOverride).toBeUndefined();
      expect(store.doc.days.tuesday.template.sleep).toHaveLength(1);

      vi.advanceTimersByTime(50);
      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.days.monday.sleepOverride).toEqual([
        { start: 60, end: 540 },
      ]);
      expect(persistedDoc.days.tuesday.sleepOverride).toBeUndefined();
    });

    it("clearing an override restores template sleep and persists", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      store.addTemplateSleep("monday", { id: "ts-1", start: 1380, end: 420 });
      store.setSleepOverride("monday", [{ start: 60, end: 540 }]);
      expect(store.doc.days.monday.sleepOverride).toBeDefined();

      store.clearSleepOverride("monday");
      expect(store.doc.days.monday.sleepOverride).toBeUndefined();

      vi.advanceTimersByTime(50);
      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.days.monday.sleepOverride).toBeUndefined();
      expect(persistedDoc.days.monday.template.sleep).toHaveLength(1);
    });
  });

  describe("todo CRUD", () => {
    it("adds, updates, and deletes todos optimistically", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 50 });
      await store.load();

      const todo: Todo = {
        _tag: "todo",
        id: "todo-1",
        title: "CS Project Milestone",
        pomodoros: 4,
        priority: "P0",
        dueDate: "friday",
      };

      store.addTodo(todo);
      expect(store.doc.todos).toHaveLength(1);
      expect(store.doc.todos[0]).toEqual(todo);

      const updatedTodo: Todo = {
        ...todo,
        pomodoros: 2,
        priority: "P1",
      };
      store.updateTodo(updatedTodo);
      expect(store.doc.todos[0].pomodoros).toBe(2);
      expect(store.doc.todos[0].priority).toBe("P1");

      store.deleteTodo("todo-1");
      expect(store.doc.todos).toHaveLength(0);

      vi.advanceTimersByTime(50);
      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.todos).toHaveLength(0);
    });
  });

  describe("export and import", () => {
    it("exports current doc as JSON", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer);
      await store.load();

      store.addTodo({
        _tag: "todo",
        id: "todo-exp",
        title: "Export Todo",
        pomodoros: 1,
        priority: "P2",
      });

      const json = await store.exportJson();
      const parsed = JSON.parse(json);
      expect(parsed.todos[0].title).toBe("Export Todo");
    });

    it("imports valid JSON, replaces doc, and persists it", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer);
      await store.load();

      const importedDoc: CalendarDoc = {
        version: 1,
        weekIdentity: "2026-08-17",
        boundaryOccupancy: [],
        settings: {
          workLength: 30,
          breakLength: 10,
          longBreakLength: 60,
          miniFocus: false,
          timezone: "UTC",
        },
        days: {
          monday: { template: { busy: [], sleep: [] }, items: [] },
          tuesday: { template: { busy: [], sleep: [] }, items: [] },
          wednesday: { template: { busy: [], sleep: [] }, items: [] },
          thursday: { template: { busy: [], sleep: [] }, items: [] },
          friday: { template: { busy: [], sleep: [] }, items: [] },
          saturday: { template: { busy: [], sleep: [] }, items: [] },
          sunday: { template: { busy: [], sleep: [] }, items: [] },
        },
        todos: [
          {
            _tag: "todo",
            id: "imported-t1",
            title: "Imported Task",
            pomodoros: 5,
            priority: "P0",
          },
        ],
      };

      const result = await store.importJson(JSON.stringify(importedDoc));
      expect(result.success).toBe(true);
      expect(store.doc.todos).toHaveLength(1);
      expect(store.doc.todos[0].title).toBe("Imported Task");
      expect(store.doc.settings.workLength).toBe(30);
    });

    it("rejects corrupt JSON import, sets errorMessage, and leaves doc untouched", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer);
      await store.load();

      store.addTodo({
        _tag: "todo",
        id: "orig-1",
        title: "Original Untouched Todo",
        pomodoros: 2,
        priority: "P3",
      });

      const result = await store.importJson("{ broken: not valid json }");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(store.errorMessage()).toBeDefined();

      // Doc must remain completely untouched
      expect(store.doc.todos).toHaveLength(1);
      expect(store.doc.todos[0].title).toBe("Original Untouched Todo");

      store.clearError();
      expect(store.errorMessage()).toBeNull();
      expect(store.status()).toBe("idle");
    });

    it("flush commits pending save immediately", async () => {
      const memoryLayer = makeMemoryStorageLayer();
      const store = createCalendarStore(memoryLayer, { debounceMs: 1000 });
      await store.load();

      store.addTodo({
        _tag: "todo",
        id: "flushed-todo",
        title: "Flushed Task",
        pomodoros: 1,
        priority: "P4",
      });

      await store.flush();
      expect(store.status()).toBe("saved");

      const persistedDoc = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const storage = yield* StorageService;
            return yield* storage.loadDoc();
          }),
          memoryLayer,
        ),
      );
      expect(persistedDoc.todos).toHaveLength(1);
      expect(persistedDoc.todos[0].id).toBe("flushed-todo");
    });
  });
});
