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
  type DayOfWeek,
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
  initialDay?: DayOfWeek;
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
  const [selectedDay, setSelectedDay] = createSignal<DayOfWeek>(
    options.initialDay ?? "monday",
  );

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

  const addBusy = (day: DayOfWeek, busy: Busy) => {
    setDoc("days", day, "items", [...doc.days[day].items, busy]);
    scheduleSave();
  };

  const updateBusy = (day: DayOfWeek, busy: Busy) => {
    setDoc(
      "days",
      day,
      "items",
      doc.days[day].items.map((item) => (item.id === busy.id ? busy : item)),
    );
    scheduleSave();
  };

  const deleteBusy = (day: DayOfWeek, id: string) => {
    setDoc(
      "days",
      day,
      "items",
      doc.days[day].items.filter((item) => item.id !== id),
    );
    scheduleSave();
  };

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
    selectedDay,
    setSelectedDay,
    load,
    flush,
    addBusy,
    updateBusy,
    deleteBusy,
    addTodo,
    updateTodo,
    deleteTodo,
    exportJson,
    importJson,
    clearError,
  };
}

export type CalendarStore = ReturnType<typeof createCalendarStore>;
