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
import { findDayConflict, formatConflict } from "./conflicts";
import {
  refusalMessage,
  resolvePlacement,
  resolveResize,
  type ResizeTarget,
} from "./placement";

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

  const rejectConflict = (
    day: DayOfWeek,
    candidate: Mutable<CalendarDoc>["days"][DayOfWeek],
  ): boolean => {
    const conflict = findDayConflict(
      candidate,
      day === "monday" ? doc.boundaryOccupancy : [],
    );
    if (!conflict) return false;
    setErrorMessage(formatConflict(conflict, day));
    setStatus("error");
    return true;
  };

  const load = async (now?: Date | number): Promise<void> => {
    const program = Effect.gen(function* () {
      const storage = yield* StorageService;
      return yield* storage.loadDoc(now);
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
    const candidate = {
      ...doc.days[day],
      items: [...doc.days[day].items, item],
    };
    if (rejectConflict(day, candidate)) return false;
    setDoc("days", day, "items", [...doc.days[day].items, item]);
    scheduleSave();
    return true;
  };

  const updateDayItem = (originalDay: DayOfWeek, item: DayItem) => {
    const targetDay = item.day;
    const candidate = {
      ...doc.days[targetDay],
      items:
        originalDay === targetDay
          ? doc.days[targetDay].items.map((existing) =>
              existing.id === item.id ? item : existing,
            )
          : [...doc.days[targetDay].items, item],
    };
    if (rejectConflict(targetDay, candidate)) return false;
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
        doc.days[originalDay].items.filter(
          (existing) => existing.id !== item.id,
        ),
      );
      setDoc("days", targetDay, "items", [...doc.days[targetDay].items, item]);
    }
    scheduleSave();
    return true;
  };

  /**
   * Move a day item to `targetDay` via the shared placement-resolution seam
   * (#14). Resolves the requested wall-clock span on the target day — adjusting
   * on collision or refusing when no 15-minute placement exists — then commits
   * through the plain update path. The moving item is excluded from its own
   * occupancy check, including within-day moves.
   */
  const moveDayItem = (
    originalDay: DayOfWeek,
    item: DayItem,
    targetDay: DayOfWeek,
    start: number,
    end: number,
  ): boolean => {
    const resolved = resolvePlacement(
      doc.days[targetDay],
      { tag: item._tag, start, end },
      item.id,
      targetDay === "monday" ? doc.boundaryOccupancy : [],
    );
    if (resolved === null) {
      setErrorMessage(refusalMessage(targetDay));
      setStatus("error");
      return false;
    }
    return updateDayItem(originalDay, {
      ...item,
      day: targetDay,
      start: resolved.start,
      end: resolved.end,
    });
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

  /**
   * Resize an existing day item on `day` via the shared placement-resolution
   * seam. The opposite edge stays fixed; the active edge clamps to the first
   * conflicting occupancy boundary. Refused resizes (shorter than 15 minutes,
   * or no non-overlapping placement) leave the item unchanged.
   */
  const resizeDayItem = (
    day: DayOfWeek,
    item: DayItem,
    target: ResizeTarget,
  ): boolean => {
    const resolved = resolveResize(
      doc.days[day],
      { tag: item._tag, start: item.start, end: item.end, id: item.id },
      target,
      day === "monday" ? doc.boundaryOccupancy : [],
    );
    if (resolved === null) {
      setErrorMessage(
        "Resize refused — keep at least 15 minutes without overlapping.",
      );
      setStatus("error");
      return false;
    }
    setDoc(
      "days",
      day,
      "items",
      doc.days[day].items.map((existing) =>
        existing.id === item.id
          ? { ...existing, start: resolved.start, end: resolved.end }
          : existing,
      ),
    );
    scheduleSave();
    return true;
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
    const candidate = {
      ...doc.days[day],
      template: {
        ...doc.days[day].template,
        busy: [...doc.days[day].template.busy, block],
      },
    };
    if (rejectConflict(day, candidate)) return false;
    setDoc("days", day, "template", "busy", [
      ...doc.days[day].template.busy,
      block,
    ]);
    scheduleSave();
    return true;
  };

  const updateTemplateBusy = (day: DayOfWeek, block: TemplateBusy) => {
    const candidate = {
      ...doc.days[day],
      template: {
        ...doc.days[day].template,
        busy: doc.days[day].template.busy.map((existing) =>
          existing.id === block.id ? block : existing,
        ),
      },
    };
    if (rejectConflict(day, candidate)) return false;
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
    return true;
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
    const candidate = {
      ...doc.days[day],
      template: {
        ...doc.days[day].template,
        sleep: [...doc.days[day].template.sleep, block],
      },
    };
    if (rejectConflict(day, candidate)) return false;
    setDoc("days", day, "template", "sleep", [
      ...doc.days[day].template.sleep,
      block,
    ]);
    scheduleSave();
    return true;
  };

  const updateTemplateSleep = (day: DayOfWeek, block: TemplateSleep) => {
    const candidate = {
      ...doc.days[day],
      template: {
        ...doc.days[day].template,
        sleep: doc.days[day].template.sleep.map((existing) =>
          existing.id === block.id ? block : existing,
        ),
      },
    };
    if (rejectConflict(day, candidate)) return false;
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
    return true;
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
    const candidate = { ...doc.days[day], sleepOverride: blocks };
    if (rejectConflict(day, candidate)) return false;
    setDoc("days", day, "sleepOverride", blocks);
    scheduleSave();
    return true;
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
    moveDayItem,
    resizeDayItem,
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
