/**
 * Application state management (Solid store + actions).
 *
 * Drives the reactive in-memory doc and coordinates with `StorageService`
 * for optimistic updates, debounced persistence, and JSON import/export.
 *
 * Rules:
 * 1. UI reaches storage only through `StorageService` via this module.
 * 2. Mutations update the in-memory store immediately (optimistic).
 * 3. Saves to storage are debounced by default.
 * 4. Corrupt import leaves current state untouched and surfaces typed error.
 */

import { createSignal } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { Effect, type Layer } from "effect";
import {
  type Busy,
  type CalendarDoc,
  type DayItem,
  type DayOfWeek,
  type Event,
  type Settings,
  type Sleep,
  type SleepBlock,
  type TemplateBusy,
  type TemplateSleep,
  type Todo,
} from "./schema";
import {
  createDefaultDoc,
  makeLocalStorageLayer,
  StorageService,
} from "./storage";

type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P];
};

export interface CalendarStoreOptions {
  debounceMs?: number;
}

export function createCalendarStore(
  storageLayer: Layer.Layer<StorageService> = makeLocalStorageLayer(),
  options: CalendarStoreOptions = {},
) {
  const debounceMs = options.debounceMs ?? 300;
  const [doc, setDoc] = createStore<Mutable<CalendarDoc>>(
    createDefaultDoc() as Mutable<CalendarDoc>,
  );
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [status, setStatus] = createSignal<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const currentDoc = unwrap(doc);
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      yield* storage.saveDoc(currentDoc);
    });

    try {
      await Effect.runPromise(Effect.provide(program, storageLayer));
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to persist document",
      );
    }
  };

  const scheduleSave = () => {
    setStatus("saving");
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void flush();
    }, debounceMs);
  };

  const load = async (): Promise<void> => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.loadDoc();
    });

    try {
      const loadedDoc = await Effect.runPromise(
        Effect.provide(program, storageLayer),
      );
      setDoc(reconcile(loadedDoc as Mutable<CalendarDoc>));
      setIsLoaded(true);
      setStatus("idle");
      setErrorMessage(null);
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to load document",
      );
    }
  };

  // -------------------------------------------------------------------------
  // Day Items CRUD (Busy, Event, Sleep)
  // -------------------------------------------------------------------------

  const addDayItem = (item: DayItem) => {
    const day = item.day;
    setDoc("days", day, "items", [...doc.days[day].items, item]);
    scheduleSave();
  };

  const updateDayItem = (originalDay: DayOfWeek, item: DayItem) => {
    const targetDay = item.day;
    if (originalDay === targetDay) {
      setDoc(
        "days",
        targetDay,
        "items",
        doc.days[targetDay].items.map((existing) =>
          existing.id === item.id ? item : existing,
        ),
      );
    } else {
      // Remove from original day and append to target day
      setDoc(
        "days",
        originalDay,
        "items",
        doc.days[originalDay].items.filter((existing) => existing.id !== item.id),
      );
      setDoc("days", targetDay, "items", [...doc.days[targetDay].items, item]);
    }
    scheduleSave();
  };

  const deleteDayItem = (day: DayOfWeek, id: string) => {
    setDoc(
      "days",
      day,
      "items",
      doc.days[day].items.filter((item) => item.id !== id),
    );
    scheduleSave();
  };

  // Busy-specific aliases
  const addBusy = (day: DayOfWeek, busy: Busy) => {
    addDayItem({ ...busy, day });
  };

  const updateBusy = (day: DayOfWeek, busy: Busy) => {
    updateDayItem(day, busy);
  };

  const deleteBusy = (day: DayOfWeek, id: string) => {
    deleteDayItem(day, id);
  };

  // Event-specific aliases
  const addEvent = (day: DayOfWeek, event: Event) => {
    addDayItem({ ...event, day });
  };

  const updateEvent = (day: DayOfWeek, event: Event) => {
    updateDayItem(day, event);
  };

  const deleteEvent = (day: DayOfWeek, id: string) => {
    deleteDayItem(day, id);
  };

  // Sleep-specific aliases
  const addSleep = (day: DayOfWeek, sleep: Sleep) => {
    addDayItem({ ...sleep, day });
  };

  const updateSleep = (day: DayOfWeek, sleep: Sleep) => {
    updateDayItem(day, sleep);
  };

  const deleteSleep = (day: DayOfWeek, id: string) => {
    deleteDayItem(day, id);
  };

  // -------------------------------------------------------------------------
  // Weekly Template CRUD (busy blocks & sleep windows per day)
  // -------------------------------------------------------------------------

  const addTemplateBusy = (day: DayOfWeek, block: TemplateBusy) => {
    setDoc(
      "days",
      day,
      "template",
      "busy",
      [...doc.days[day].template.busy, block],
    );
    scheduleSave();
  };

  const updateTemplateBusy = (day: DayOfWeek, block: TemplateBusy) => {
    setDoc(
      "days",
      day,
      "template",
      "busy",
      doc.days[day].template.busy.map((existing) =>
        existing.id === block.id ? block : existing,
      ),
    );
    scheduleSave();
  };

  const deleteTemplateBusy = (day: DayOfWeek, id: string) => {
    setDoc(
      "days",
      day,
      "template",
      "busy",
      doc.days[day].template.busy.filter((existing) => existing.id !== id),
    );
    scheduleSave();
  };

  const addTemplateSleep = (day: DayOfWeek, block: TemplateSleep) => {
    setDoc(
      "days",
      day,
      "template",
      "sleep",
      [...doc.days[day].template.sleep, block],
    );
    scheduleSave();
  };

  const updateTemplateSleep = (day: DayOfWeek, block: TemplateSleep) => {
    setDoc(
      "days",
      day,
      "template",
      "sleep",
      doc.days[day].template.sleep.map((existing) =>
        existing.id === block.id ? block : existing,
      ),
    );
    scheduleSave();
  };

  const deleteTemplateSleep = (day: DayOfWeek, id: string) => {
    setDoc(
      "days",
      day,
      "template",
      "sleep",
      doc.days[day].template.sleep.filter((existing) => existing.id !== id),
    );
    scheduleSave();
  };

  // -------------------------------------------------------------------------
  // Sleep override (one-off, per day)
  // -------------------------------------------------------------------------

  /** Replace the day's template sleep with a one-off set of windows. */
  const setSleepOverride = (day: DayOfWeek, blocks: SleepBlock[]) => {
    setDoc("days", day, "sleepOverride", blocks);
    scheduleSave();
  };

  /** Remove the day's sleep override, restoring template sleep. */
  const clearSleepOverride = (day: DayOfWeek) => {
    setDoc("days", day, "sleepOverride", undefined);
    scheduleSave();
  };

  // -------------------------------------------------------------------------
  // Todo CRUD
  // -------------------------------------------------------------------------

  const addTodo = (todo: Todo) => {
    setDoc("todos", [...doc.todos, todo]);
    scheduleSave();
  };

  const updateTodo = (todo: Todo) => {
    setDoc(
      "todos",
      doc.todos.map((t) => (t.id === todo.id ? todo : t)),
    );
    scheduleSave();
  };

  const deleteTodo = (id: string) => {
    setDoc(
      "todos",
      doc.todos.filter((t) => t.id !== id),
    );
    scheduleSave();
  };

  // -------------------------------------------------------------------------
  // Settings & Doc
  // -------------------------------------------------------------------------

  const updateSettings = (partialSettings: Partial<Settings>) => {
    setDoc("settings", { ...doc.settings, ...partialSettings });
    scheduleSave();
  };

  // -------------------------------------------------------------------------
  // Export & Import
  // -------------------------------------------------------------------------

  const exportJson = async (): Promise<string> => {
    const currentDoc = unwrap(doc);
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.exportDocJson(currentDoc);
    });
    return Effect.runPromise(Effect.provide(program, storageLayer));
  };

  const importJson = async (
    json: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      const imported = yield* storage.importDocJson(json);
      yield* storage.saveDoc(imported);
      return imported;
    });

    try {
      const importedDoc = await Effect.runPromise(
        Effect.provide(program, storageLayer),
      );
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      setDoc(reconcile(importedDoc as Mutable<CalendarDoc>));
      setErrorMessage(null);
      setStatus("saved");
      return { success: true };
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "Invalid or corrupt JSON document";
      setErrorMessage(msg);
      setStatus("error");
      return { success: false, error: msg };
    }
  };

  const clearError = () => {
    setErrorMessage(null);
    if (status() === "error") {
      setStatus("idle");
    }
  };

  return {
    doc,
    isLoaded,
    status,
    errorMessage,
    load,
    flush,
    addDayItem,
    updateDayItem,
    deleteDayItem,
    addBusy,
    updateBusy,
    deleteBusy,
    addEvent,
    updateEvent,
    deleteEvent,
    addSleep,
    updateSleep,
    deleteSleep,
    addTemplateBusy,
    updateTemplateBusy,
    deleteTemplateBusy,
    addTemplateSleep,
    updateTemplateSleep,
    deleteTemplateSleep,
    setSleepOverride,
    clearSleepOverride,
    addTodo,
    updateTodo,
    deleteTodo,
    updateSettings,
    exportJson,
    importJson,
    clearError,
  };
}

export type CalendarStore = ReturnType<typeof createCalendarStore>;
