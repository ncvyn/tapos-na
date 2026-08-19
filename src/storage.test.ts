import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  createDefaultDoc,
  exportDocJson,
  importDocJson,
  makeLocalStorageLayer,
  makeMemoryStorageLayer,
  StorageService,
} from "./storage";
import { decodeCalendarDoc } from "./schema";

describe("storage seam", () => {
  describe("createDefaultDoc", () => {
    it("creates a schema-valid CalendarDoc", () => {
      const doc = createDefaultDoc("UTC");
      const decoded = decodeCalendarDoc(doc);
      expect(decoded._tag).toBe("Right");
    });

    it("defaults timezone gracefully if none provided", () => {
      const doc = createDefaultDoc();
      expect(typeof doc.settings.timezone).toBe("string");
      const decoded = decodeCalendarDoc(doc);
      expect(decoded._tag).toBe("Right");
    });

    it("produces settings without a weekStart key (week is always Monday-anchored)", () => {
      const doc = createDefaultDoc("UTC");
      expect(doc.settings).not.toHaveProperty("weekStart");
    });
  });

  describe("exportDocJson & importDocJson", () => {
    it("exports doc as valid JSON string and round-trips via importDocJson", async () => {
      const initialDoc = createDefaultDoc("UTC");
      const doc = {
        ...initialDoc,
        todos: [
          {
            _tag: "todo" as const,
            id: "todo-1",
            title: "Test Todo",
            pomodoros: 3,
            priority: "P0" as const,
            dueDate: "friday" as const,
          },
        ],
      };

      const json = await Effect.runPromise(exportDocJson(doc));
      expect(typeof json).toBe("string");

      const imported = await Effect.runPromise(importDocJson(json));
      expect(imported).toEqual(doc);
    });

    it("strips apiKey from exported JSON", async () => {
      const initialDoc = createDefaultDoc("UTC");
      const doc = {
        ...initialDoc,
        settings: {
          ...initialDoc.settings,
          apiKey: "secret-key-123",
        },
      };

      const json = await Effect.runPromise(exportDocJson(doc));
      const parsed = JSON.parse(json);
      expect(parsed.settings.apiKey).toBeUndefined();
    });

    it("fails importDocJson with CorruptDocError for malformed JSON", async () => {
      const result = await Effect.runPromiseExit(
        importDocJson("{ not valid json"),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const error = result.cause;
        expect(JSON.stringify(error)).toContain("CorruptDocError");
      }
    });

    it("fails importDocJson with CorruptDocError for schema-invalid doc", async () => {
      const invalidDoc = {
        version: 1,
        settings: {
          timezone: "Mars/Olympus",
        },
      };
      const result = await Effect.runPromiseExit(
        importDocJson(JSON.stringify(invalidDoc)),
      );
      expect(Exit.isFailure(result)).toBe(true);
    });

    it("rejects import docs with overlapping day blocks", async () => {
      const initialDoc = createDefaultDoc("Asia/Manila");
      const conflictingDoc = {
        ...initialDoc,
        days: {
          ...initialDoc.days,
          monday: {
            ...initialDoc.days.monday,
            items: [
              {
                _tag: "busy" as const,
                id: "busy-1",
                title: "Test 1",
                day: "monday" as const,
                start: 0,
                end: 120,
              },
              {
                _tag: "event" as const,
                id: "event-1",
                title: "Test 2",
                day: "monday" as const,
                start: 0,
                end: 120,
              },
              {
                _tag: "busy" as const,
                id: "busy-2",
                title: "Test 3",
                day: "monday" as const,
                start: 0,
                end: 240,
              },
            ],
          },
        },
      };

      const result = await Effect.runPromiseExit(
        importDocJson(JSON.stringify(conflictingDoc)),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(JSON.stringify(result.cause)).toContain("overlap");
      }
    });
  });

  describe("StorageService (Memory Layer)", () => {
    it("loads default doc when empty", async () => {
      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        return yield* storage.loadDoc();
      });

      const doc = await Effect.runPromise(
        Effect.provide(program, makeMemoryStorageLayer()),
      );
      expect(doc.version).toBe(1);
      expect(doc.todos).toEqual([]);
    });

    it("saves and loads updated doc", async () => {
      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        const initial = yield* storage.loadDoc();
        const updated = {
          ...initial,
          todos: [
            {
              _tag: "todo" as const,
              id: "t1",
              title: "Do homework",
              pomodoros: 2,
              priority: "P1" as const,
            },
          ],
        };
        yield* storage.saveDoc(updated);
        const loaded = yield* storage.loadDoc();
        return { initial, loaded, updated };
      });

      const { loaded, updated } = await Effect.runPromise(
        Effect.provide(program, makeMemoryStorageLayer()),
      );
      expect(loaded).toEqual(updated);
    });
  });

  describe("StorageService (LocalStorage Layer)", () => {
    function createMockStorage(): Storage {
      const map = new Map<string, string>();
      return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
        removeItem: (key: string) => {
          map.delete(key);
        },
        clear: () => {
          map.clear();
        },
        key: (index: number) => Array.from(map.keys())[index] ?? null,
        get length() {
          return map.size;
        },
      };
    }

    it("loads default doc on first access and stores it", async () => {
      const mockStorage = createMockStorage();
      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        return yield* storage.loadDoc();
      });

      const doc = await Effect.runPromise(
        Effect.provide(program, makeLocalStorageLayer("test-key", mockStorage)),
      );
      expect(doc.version).toBe(1);
      expect(mockStorage.getItem("test-key")).toBeDefined();
    });

    it("saves and retrieves doc from mock storage", async () => {
      const mockStorage = createMockStorage();
      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        const initial = yield* storage.loadDoc();
        const updated = {
          ...initial,
          todos: [
            {
              _tag: "todo" as const,
              id: "todo-persisted",
              title: "Persisted item",
              pomodoros: 1,
              priority: "P0" as const,
            },
          ],
        };
        yield* storage.saveDoc(updated);
        const reloaded = yield* storage.loadDoc();
        return { updated, reloaded };
      });

      const { updated, reloaded } = await Effect.runPromise(
        Effect.provide(program, makeLocalStorageLayer("test-key", mockStorage)),
      );
      expect(reloaded).toEqual(updated);
    });

    it("fails with CorruptDocError when localStorage contains invalid data", async () => {
      const mockStorage = createMockStorage();
      mockStorage.setItem("test-key", "{ broken json");

      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        return yield* storage.loadDoc();
      });

      const result = await Effect.runPromiseExit(
        Effect.provide(program, makeLocalStorageLayer("test-key", mockStorage)),
      );
      expect(Exit.isFailure(result)).toBe(true);
    });

    it("fails with CorruptDocError when stored doc carries a legacy weekStart key", async () => {
      const mockStorage = createMockStorage();
      const legacyDoc = {
        version: 1,
        settings: {
          weekStart: "monday",
          workLength: 25,
          breakLength: 5,
          longBreakLength: 30,
          miniFocus: true,
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
        todos: [],
      };
      mockStorage.setItem("test-key", JSON.stringify(legacyDoc));

      const program = Effect.gen(function* () {
        const storage = yield* StorageService;
        return yield* storage.loadDoc();
      });

      const result = await Effect.runPromiseExit(
        Effect.provide(program, makeLocalStorageLayer("test-key", mockStorage)),
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(JSON.stringify(result.cause)).toContain("CorruptDocError");
      }
    });
  });
});
