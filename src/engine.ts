/**
 * Engine core (pure, deterministic, TDD).
 *
 * Computes the derived pomodoro schedule from user inputs:
 * (userItems, template, settings) -> segments (UTC-normalized).
 *
 * Rules:
 * 1. Free time = day [0, 1440] minus sleep, busy, and event blocks (events always win).
 * 2. Greedy placement by priority (P0 first, then P1..P4).
 * 3. Configurable work & break lengths; long break after every 4th pomodoro on a day.
 * 4. Mini-focus = 0.5 pomodoro filling gaps shorter than workLength (toggleable).
 * 5. Due date = hard bound (todos are not scheduled past their due date).
 * 6. Pure & deterministic — no I/O, no DOM, fixed outputs for fixed inputs.
 */

import {
  WEEKDAY_NAMES,
  type CalendarDoc,
  type Day,
  type DayOfWeek,
  type Priority,
  type Settings,
  type Todo,
} from "./schema";

// ---------------------------------------------------------------------------
// Engine Types
// ---------------------------------------------------------------------------

/** A free time interval on a day [start, end] in minutes from midnight (0..1440). */
export interface FreeSpan {
  start: number;
  end: number;
}

/**
 * Where an effective block came from. `template` = recurring weekly template;
 * `one-off` = a day-pinned item; `override` = a one-off sleep override that
 * replaces that day's template sleep.
 */
export type BlockSource = "template" | "one-off" | "override";

/**
 * An effective occupying block on a day, after template expansion. Combines
 * the recurring template (busy + sleep), one-off items, and any sleep
 * override so the engine and UI share one view of "what occupies this day".
 */
export interface EffectiveBlock {
  _tag: "busy" | "event" | "sleep";
  id: string;
  title?: string;
  start: number;
  end: number;
  source: BlockSource;
}

/** Work segment scheduled for a todo. */
export interface WorkSegment {
  _tag: "work";
  todoId: string;
  todoTitle: string;
  priority: Priority;
  start: number;
  end: number;
  pomodoroNumber: number;
  isMiniFocus: boolean;
  count: number; // 1 for full pomodoro, 0.5 for mini-focus
}

/** Break segment between work sessions. */
export interface BreakSegment {
  _tag: "break";
  start: number;
  end: number;
  breakType: "short" | "long";
  associatedTodoId?: string;
}

export type ScheduledSegment = WorkSegment | BreakSegment;

/** Schedule output for a single day. */
export interface DaySchedule {
  day?: DayOfWeek;
  freeSpans: FreeSpan[];
  segments: ScheduledSegment[];
}

export interface TodoProgress {
  todo: Todo;
  remainingPomodoros: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

/** Get 0-indexed day position in storage order (Monday = 0, Sunday = 6). */
export function getDayIndex(day: DayOfWeek): number {
  return WEEKDAY_NAMES.indexOf(day);
}

/** Compare priorities for sorting (P0 comes first). */
export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_ORDER[a] - PRIORITY_ORDER[b];
}

// ---------------------------------------------------------------------------
// Free Spans Computation
// ---------------------------------------------------------------------------

/**
 * Expand a day into its effective occupying blocks: template busy blocks and
 * template sleep windows (or, when a sleep override is present, the override
 * blocks instead), plus the day's one-off items. Deterministic and pure —
 * this is the template→week expansion that feeds both the engine and the UI.
 *
 * Block order: template busy, one-off items (in stored order), then sleep
 * (override blocks if set, otherwise template sleep).
 */
export function expandDay(day: Day): EffectiveBlock[] {
  const blocks: EffectiveBlock[] = [];

  for (const block of day.template.busy) {
    blocks.push({
      _tag: "busy",
      id: block.id,
      title: block.title,
      start: block.start,
      end: block.end,
      source: "template",
    });
  }

  for (const item of day.items) {
    if (item._tag === "busy") {
      blocks.push({
        _tag: "busy",
        id: item.id,
        title: item.title,
        start: item.start,
        end: item.end,
        source: "one-off",
      });
    } else if (item._tag === "event") {
      blocks.push({
        _tag: "event",
        id: item.id,
        title: item.title,
        start: item.start,
        end: item.end,
        source: "one-off",
      });
    } else {
      blocks.push({
        _tag: "sleep",
        id: item.id,
        start: item.start,
        end: item.end,
        source: "one-off",
      });
    }
  }

  if (day.sleepOverride !== undefined) {
    day.sleepOverride.forEach((block, index) => {
      blocks.push({
        _tag: "sleep",
        id: `override-${index}-${block.start}-${block.end}`,
        start: block.start,
        end: block.end,
        source: "override",
      });
    });
  } else {
    for (const block of day.template.sleep) {
      blocks.push({
        _tag: "sleep",
        id: block.id,
        start: block.start,
        end: block.end,
        source: "template",
      });
    }
  }

  return blocks;
}

/**
 * Compute free time spans for a day [0, 1440] by subtracting the effective
 * occupying blocks from `expandDay` (template busy/sleep, one-off items, and
 * any sleep override).
 *
 * - Sleep spans crossing midnight (start > end) cover [start, 1440] and [0, end].
 * - Busy and event blocks block out their [start, end] intervals.
 * - Overlapping/adjacent occupied blocks are merged before inverting.
 */
export function getFreeSpans(day: Day): FreeSpan[] {
  const occupied: Array<{ start: number; end: number }> = [];

  for (const block of expandDay(day)) {
    addOccupiedSpan(occupied, block.start, block.end, block._tag === "sleep");
  }

  // Clamp to [0, 1440] and filter non-positive spans
  const clamped: Array<{ start: number; end: number }> = [];
  for (const span of occupied) {
    const start = Math.max(0, Math.min(1440, span.start));
    const end = Math.max(0, Math.min(1440, span.end));
    if (start < end) {
      clamped.push({ start, end });
    }
  }

  // Sort occupied spans by start asc, end asc
  clamped.sort((a, b) => a.start - b.start || a.end - b.end);

  // Merge overlapping or contiguous occupied spans
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of clamped) {
    if (merged.length === 0) {
      merged.push({ ...span });
    } else {
      const last = merged[merged.length - 1];
      if (span.start <= last.end) {
        last.end = Math.max(last.end, span.end);
      } else {
        merged.push({ ...span });
      }
    }
  }

  // Invert merged occupied spans over [0, 1440] to get free spans
  const freeSpans: FreeSpan[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) {
      freeSpans.push({ start: cursor, end: span.start });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < 1440) {
    freeSpans.push({ start: cursor, end: 1440 });
  }

  return freeSpans;
}

function addOccupiedSpan(
  spans: Array<{ start: number; end: number }>,
  start: number,
  end: number,
  allowMidnightWrap: boolean,
) {
  if (allowMidnightWrap && start > end) {
    // Crosses midnight: cover [start, 1440] and [0, end]
    spans.push({ start, end: 1440 });
    spans.push({ start: 0, end });
  } else if (start < end) {
    spans.push({ start, end });
  }
}

// ---------------------------------------------------------------------------
// Day & Week Scheduling Core
// ---------------------------------------------------------------------------

/**
 * Schedule pomodoro work and break segments into a day's free spans.
 *
 * @param day The Day object containing template & items
 * @param todos List of candidate todos with remaining pomodoro counts
 * @param settings App settings (lengths, miniFocus toggle)
 * @param dayName Optional day name for due date checking and output
 * @returns DaySchedule containing freeSpans, scheduled segments, and updated remaining pomodoros map
 */
export function computeDaySchedule(
  day: Day,
  todos: TodoProgress[],
  settings: Settings,
  dayName?: DayOfWeek,
): { daySchedule: DaySchedule; updatedTodos: TodoProgress[] } {
  const freeSpans = getFreeSpans(day);
  const segments: ScheduledSegment[] = [];

  // Clone todo progress map
  const todoProgressMap = new Map<string, TodoProgress>(
    todos.map((tp) => [
      tp.todo.id,
      { todo: tp.todo, remainingPomodoros: tp.remainingPomodoros },
    ]),
  );

  // Filter eligible todos for this day (due date bound & remaining count > 0)
  const eligibleProgress = todos
    .filter((tp) => {
      if (tp.remainingPomodoros <= 0) return false;
      if (dayName !== undefined && tp.todo.dueDate !== undefined) {
        const currentDayIndex = getDayIndex(dayName);
        const dueIndex = getDayIndex(tp.todo.dueDate);
        if (currentDayIndex > dueIndex) return false;
      }
      return true;
    })
    .sort((a, b) => comparePriority(a.todo.priority, b.todo.priority));

  let dayPomodoroCount = 0; // counts full pomodoros on this day for long break cadence
  const miniFocusLength = settings.workLength / 2;

  for (const span of freeSpans) {
    let cursor = span.start;

    while (cursor < span.end) {
      // Find highest priority eligible todo with remaining pomodoros > 0
      const current = eligibleProgress.find(
        (tp) => (todoProgressMap.get(tp.todo.id)?.remainingPomodoros ?? 0) > 0,
      );

      if (!current) break; // no remaining todos to schedule

      const prog = todoProgressMap.get(current.todo.id)!;
      const gap = span.end - cursor;
      const needed = prog.remainingPomodoros;

      // Determine work duration and type
      let workDuration = 0;
      let isMiniFocus = false;
      let countUsed = 0;

      if (needed >= 1 && gap >= settings.workLength) {
        workDuration = settings.workLength;
        isMiniFocus = false;
        countUsed = 1;
      } else if (needed < 1 && gap >= miniFocusLength) {
        workDuration = miniFocusLength;
        isMiniFocus = true;
        countUsed = needed;
      } else if (settings.miniFocus && gap >= miniFocusLength && needed >= 0.5) {
        workDuration = miniFocusLength;
        isMiniFocus = true;
        countUsed = 0.5;
      }

      if (workDuration === 0) {
        // Gap is too small for work
        break;
      }

      const workEnd = cursor + workDuration;
      const pomodoroNumber =
        Math.floor(current.todo.pomodoros - prog.remainingPomodoros) + 1;

      segments.push({
        _tag: "work",
        todoId: current.todo.id,
        todoTitle: current.todo.title,
        priority: current.todo.priority,
        start: cursor,
        end: workEnd,
        pomodoroNumber,
        isMiniFocus,
        count: countUsed,
      });

      cursor = workEnd;
      prog.remainingPomodoros -= countUsed;

      if (!isMiniFocus) {
        dayPomodoroCount += 1;
      }

      // Determine break
      const isLongBreak = !isMiniFocus && dayPomodoroCount % 4 === 0;
      const breakDuration = isLongBreak
        ? settings.longBreakLength
        : settings.breakLength;
      const actualBreakLen = Math.min(breakDuration, span.end - cursor);

      if (actualBreakLen > 0) {
        segments.push({
          _tag: "break",
          start: cursor,
          end: cursor + actualBreakLen,
          breakType: isLongBreak ? "long" : "short",
          associatedTodoId: current.todo.id,
        });
        cursor += actualBreakLen;
      }
    }
  }

  // Prepare updated todos list maintaining original order
  const updatedTodos: TodoProgress[] = todos.map((tp) => ({
    todo: tp.todo,
    remainingPomodoros:
      todoProgressMap.get(tp.todo.id)?.remainingPomodoros ??
      tp.remainingPomodoros,
  }));

  return {
    daySchedule: {
      day: dayName,
      freeSpans,
      segments,
    },
    updatedTodos,
  };
}

/**
 * Compute schedule for the entire week (Monday through Sunday) from a CalendarDoc.
 *
 * Evaluates days in storage order. Todos carry over remaining pomodoros day-to-day.
 */
export function computeSchedule(
  doc: CalendarDoc,
): Record<DayOfWeek, DaySchedule> {
  let todoProgress: TodoProgress[] = doc.todos.map((todo) => ({
    todo,
    remainingPomodoros: todo.pomodoros,
  }));

  const result = {} as Record<DayOfWeek, DaySchedule>;

  for (const dayName of WEEKDAY_NAMES) {
    const day = doc.days[dayName];
    const { daySchedule, updatedTodos } = computeDaySchedule(
      day,
      todoProgress,
      doc.settings,
      dayName,
    );

    result[dayName] = daySchedule;
    todoProgress = updatedTodos;
  }

  return result;
}
