/**
 * Storage seam (Effect-based).
 *
 * Provides persistence for `CalendarDoc` (localStorage in browser, in-memory
 * for tests/headless), JSON import/export, and schema validation on boundary.
 *
 * Rules:
 * 1. UI & state only reach storage through the `StorageService` seam.
 * 2. Export strips sensitive credentials (e.g. TODO(r2) apiKey).
 * 3. Import validates with strict schema; corrupt JSON/doc fails loudly with
 *    `CorruptDocError` without mutating or corrupting the current doc.
 * 4. Empty storage defaults to a valid initial `CalendarDoc`.
 */

import { Context, Data, Effect, Layer } from "effect";
import {
  type CalendarDoc,
  decodeCalendarDoc,
  encodeCalendarDoc,
} from "./schema";

export const STORAGE_KEY = "tapos-na:calendar-doc:v1";

// ---------------------------------------------------------------------------
// Typed Errors
// ---------------------------------------------------------------------------

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CorruptDocError extends Data.TaggedError("CorruptDocError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Default Doc Creation
// ---------------------------------------------------------------------------

export function createDefaultDoc(timezone?: string): CalendarDoc {
  let tz = timezone;
  if (!tz) {
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      tz = "UTC";
    }
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }

  return {
    version: 1,
    settings: {
      weekStart: "monday",
      workLength: 25,
      breakLength: 5,
      longBreakLength: 30,
      miniFocus: true,
      timezone: tz,
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
    todos: [],
  };
}

// ---------------------------------------------------------------------------
// Pure Export & Import
// ---------------------------------------------------------------------------

/**
 * Export `CalendarDoc` to pretty-printed JSON string.
 * Strips `apiKey` from exported settings.
 */
export function exportDocJson(doc: CalendarDoc): Effect.Effect<string, never> {
  return Effect.sync(() => {
    const { apiKey: _, ...settingsWithoutKey } = doc.settings;
    const docToExport: CalendarDoc = {
      ...doc,
      settings: settingsWithoutKey,
    };
    const encoded = encodeCalendarDoc(docToExport);
    return JSON.stringify(encoded, null, 2);
  });
}

/**
 * Import `CalendarDoc` from a JSON string.
 * Fails with `CorruptDocError` if JSON is invalid or fails schema decoding.
 */
export function importDocJson(
  json: string,
): Effect.Effect<CalendarDoc, CorruptDocError> {
  return Effect.try({
    try: () => JSON.parse(json),
    catch: (cause) =>
      new CorruptDocError({
        message: "Failed to parse JSON string",
        cause,
      }),
  }).pipe(
    Effect.flatMap((parsed) => {
      const decoded = decodeCalendarDoc(parsed);
      if (decoded._tag === "Left") {
        return Effect.fail(
          new CorruptDocError({
            message: `Calendar doc failed schema validation: ${decoded.left.message}`,
            cause: decoded.left,
          }),
        );
      }
      return Effect.succeed(decoded.right);
    }),
  );
}

// ---------------------------------------------------------------------------
// StorageService Seam
// ---------------------------------------------------------------------------

export interface StorageService {
  readonly loadDoc: () => Effect.Effect<CalendarDoc, StorageError | CorruptDocError>;
  readonly saveDoc: (doc: CalendarDoc) => Effect.Effect<void, StorageError>;
  readonly exportDocJson: (doc: CalendarDoc) => Effect.Effect<string>;
  readonly importDocJson: (json: string) => Effect.Effect<CalendarDoc, CorruptDocError>;
}

export const StorageService = Context.GenericTag<StorageService>("StorageService");

// ---------------------------------------------------------------------------
// Implementations (In-Memory & LocalStorage)
// ---------------------------------------------------------------------------

export function makeMemoryStorageLayer(initialDoc?: CalendarDoc): Layer.Layer<StorageService> {
  let currentDoc: CalendarDoc | null = initialDoc ? { ...initialDoc } : null;

  return Layer.succeed(
    StorageService,
    StorageService.of({
      loadDoc: () =>
        Effect.sync(() => {
          if (currentDoc === null) {
            currentDoc = createDefaultDoc();
          }
          return { ...currentDoc };
        }),
      saveDoc: (doc: CalendarDoc) =>
        Effect.sync(() => {
          currentDoc = { ...doc };
        }),
      exportDocJson: (doc: CalendarDoc) => exportDocJson(doc),
      importDocJson: (json: string) => importDocJson(json),
    }),
  );
}

export function makeLocalStorageLayer(
  storageKey: string = STORAGE_KEY,
  storage?: Storage,
): Layer.Layer<StorageService> {
  const getStorage = (): Storage | undefined => {
    if (storage) return storage;
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    return undefined;
  };

  return Layer.succeed(
    StorageService,
    StorageService.of({
      loadDoc: () =>
        Effect.try({
          try: () => {
            const store = getStorage();
            if (!store) {
              return createDefaultDoc();
            }
            const raw = store.getItem(storageKey);
            if (!raw) {
              const defaultDoc = createDefaultDoc();
              const encoded = encodeCalendarDoc(defaultDoc);
              store.setItem(storageKey, JSON.stringify(encoded));
              return defaultDoc;
            }
            const parsed = JSON.parse(raw);
            const decoded = decodeCalendarDoc(parsed);
            if (decoded._tag === "Left") {
              throw new CorruptDocError({
                message: `Stored document failed schema validation: ${decoded.left.message}`,
                cause: decoded.left,
              });
            }
            return decoded.right;
          },
          catch: (error) => {
            if (error instanceof CorruptDocError) {
              return error;
            }
            return new StorageError({
              message: `Failed to load document from localStorage: ${String(error)}`,
              cause: error,
            });
          },
        }),
      saveDoc: (doc: CalendarDoc) =>
        Effect.try({
          try: () => {
            const store = getStorage();
            if (!store) return;
            const encoded = encodeCalendarDoc(doc);
            store.setItem(storageKey, JSON.stringify(encoded));
          },
          catch: (cause) =>
            new StorageError({
              message: "Failed to save document to localStorage",
              cause,
            }),
        }),
      exportDocJson: (doc: CalendarDoc) => exportDocJson(doc),
      importDocJson: (json: string) => importDocJson(json),
    }),
  );
}
