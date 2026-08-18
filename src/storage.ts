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
  WEEKDAY_NAMES,
  type BoundaryOccupancy,
  type CalendarDoc,
  decodeWeekIdentity,
  decodeCalendarDoc,
  encodeCalendarDoc,
} from "./schema";
import { findCalendarConflict, formatConflict } from "./conflicts";
import {
  addDays,
  formatLocalDate,
  getWeekIdentity,
  type LocalDate,
} from "./time";

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

export function createDefaultDoc(
  timezone?: string,
  now: Date | number = new Date(),
): CalendarDoc {
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
    weekStart: getWeekIdentity(tz, now),
    boundaryOccupancy: [],
    settings: {
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

function weekIdentityToDate(identity: string): LocalDate {
  const [year, month, day] = identity.split("-").map(Number);
  return { year, month, day };
}

function isValidWeekIdentity(identity: string): boolean {
  return decodeWeekIdentity(identity)._tag === "Right";
}

function boundaryFromSpan(
  id: string,
  start: number,
  end: number,
): BoundaryOccupancy | null {
  return start > end && end > 0 ? { id, start: 0, end } : null;
}

function deriveBoundaryOccupancy(
  doc: CalendarDoc,
  carryOneOffSleep: boolean,
): BoundaryOccupancy[] {
  const sunday = doc.days.sunday;
  const boundary: BoundaryOccupancy[] = [];

  // A Sunday override replaces recurring sleep for that Week day. When weeks
  // are skipped, the override is gone and the recurring template resumes.
  const recurringSleep =
    carryOneOffSleep && sunday.sleepOverride !== undefined
      ? sunday.sleepOverride.map((block, index) => ({
          id: `boundary-override-${index}-${block.start}-${block.end}`,
          start: block.start,
          end: block.end,
        }))
      : sunday.template.sleep.map((block) => ({
          id: `boundary-template-${block.id}`,
          start: block.start,
          end: block.end,
        }));

  for (const block of recurringSleep) {
    const derived = boundaryFromSpan(block.id, block.start, block.end);
    if (derived) boundary.push(derived);
  }

  if (carryOneOffSleep) {
    for (const item of sunday.items) {
      if (item._tag !== "sleep") continue;
      const derived = boundaryFromSpan(
        `boundary-one-off-${item.id}`,
        item.start,
        item.end,
      );
      if (derived) boundary.push(derived);
    }
  }

  return boundary;
}

/**
 * Roll a document forward to a later local Week. Recurring templates survive;
 * Week-owned data is reset and Monday boundary occupancy is freshly derived.
 */
export function rolloverCalendarDoc(
  doc: CalendarDoc,
  targetWeekStart: string,
): CalendarDoc {
  if (!isValidWeekIdentity(doc.weekStart)) {
    throw new Error(`Invalid stored Week identity: ${doc.weekStart}`);
  }
  if (!isValidWeekIdentity(targetWeekStart)) {
    throw new Error(`Invalid target Week identity: ${targetWeekStart}`);
  }
  if (targetWeekStart === doc.weekStart) return doc;

  const sourceDate = weekIdentityToDate(doc.weekStart);
  const targetDate = weekIdentityToDate(targetWeekStart);
  const previousWeek = addDays(targetDate, -7);
  const isImmediate = formatLocalDate(previousWeek) === doc.weekStart;
  if (Date.UTC(targetDate.year, targetDate.month - 1, targetDate.day) <
      Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day)) {
    throw new Error("Cannot roll a CalendarDoc backward");
  }

  const days = {} as {
    -readonly [Key in keyof CalendarDoc["days"]]: CalendarDoc["days"][Key];
  };
  for (const day of WEEKDAY_NAMES) {
    const sourceDay = doc.days[day];
    days[day] = {
      template: sourceDay.template,
      items: [],
    };
  }

  return {
    version: doc.version,
    weekStart: targetWeekStart,
    boundaryOccupancy: deriveBoundaryOccupancy(doc, isImmediate),
    settings: doc.settings,
    days,
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
      const conflict = findCalendarConflict(decoded.right);
      if (conflict) {
        return Effect.fail(
          new CorruptDocError({
            message: `Calendar doc contains invalid overlap: ${formatConflict(conflict)}`,
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
  readonly loadDoc: (now?: Date | number) => Effect.Effect<CalendarDoc, StorageError | CorruptDocError>;
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
      loadDoc: (now = new Date()) =>
        Effect.try({
          try: () => {
            if (currentDoc === null) {
              currentDoc = createDefaultDoc(undefined, now);
            }
            const rolled = rolloverCalendarDoc(
              currentDoc,
              getWeekIdentity(currentDoc.settings.timezone, now),
            );
            const conflict = findCalendarConflict(rolled);
            if (conflict) {
              throw new CorruptDocError({
                message: `Stored document contains invalid overlap: ${formatConflict(conflict)}`,
              });
            }
            currentDoc = rolled;
            return { ...rolled };
          },
          catch: (cause) => {
            if (cause instanceof CorruptDocError) return cause;
            return new StorageError({
              message: "Failed to load document from memory",
              cause,
            });
          },
        }),
      saveDoc: (doc: CalendarDoc) =>
        Effect.try({
          try: () => {
            const conflict = findCalendarConflict(doc);
            if (conflict) {
              throw new StorageError({
                message: `Cannot save document with invalid overlap: ${formatConflict(conflict)}`,
              });
            }
            currentDoc = { ...doc };
          },
          catch: (cause) =>
            cause instanceof StorageError
              ? cause
              : new StorageError({
                  message: "Failed to save document to memory",
                  cause,
                }),
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
      loadDoc: (now = new Date()) =>
        Effect.try({
          try: () => {
            const store = getStorage();
            if (!store) {
              return createDefaultDoc(undefined, now);
            }
            const raw = store.getItem(storageKey);
            if (!raw) {
              const defaultDoc = createDefaultDoc(undefined, now);
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
            const targetWeekStart = getWeekIdentity(
              decoded.right.settings.timezone,
              now,
            );
            const rolled = rolloverCalendarDoc(decoded.right, targetWeekStart);
            const conflict = findCalendarConflict(rolled);
            if (conflict) {
              throw new CorruptDocError({
                message: `Stored document contains invalid overlap: ${formatConflict(conflict)}`,
              });
            }
            if (rolled !== decoded.right) {
              store.setItem(storageKey, JSON.stringify(encodeCalendarDoc(rolled)));
            }
            return rolled;
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
            const conflict = findCalendarConflict(doc);
            if (conflict) {
              throw new StorageError({
                message: `Cannot save document with invalid overlap: ${formatConflict(conflict)}`,
              });
            }
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
