/**
 * Timer core — the pure wall-clock resolver (T8).
 *
 * Maps the derived per-day schedule (minutes from local midnight) onto the
 * actual wall clock via the stored IANA timezone, then answers "what's live
 * right now": `(schedule, now) -> liveState`. DST-aware: every segment
 * boundary is resolved from a local wall-clock time to an absolute UTC
 * instant (see `time.ts`), so real elapsed time (`end − now`) is exact even
 * across a transition.
 *
 * Rules:
 * 1. `current` = the segment whose [startMs, endMs) contains `now`.
 * 2. remaining = end − now; wasted = now − start, for the live segment only.
 * 3. Auto-start is emergent: as `now` crosses a segment start, the state
 *    flips to active — no start button, and late time is lost, never
 *    recovered (the segment still ends exactly at its scheduled end).
 * 4. Pure & deterministic — no I/O, no DOM.
 */

import { type DayOfWeek, WEEKDAY_NAMES } from "./schema";
import { type DaySchedule, type ScheduledSegment } from "./engine";
import {
  addDays,
  getWeekStartDate,
  localMinutesToUtc,
  type LocalDate,
} from "./time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A scheduled segment pinned to an absolute UTC instant (ms). */
export interface SegmentRef {
  day: DayOfWeek;
  segment: ScheduledSegment;
  startMs: number;
  endMs: number;
}

/**
 * "before" — no segment is running yet and one is upcoming;
 * "active" — a segment is running; "after" — the week's last segment has ended.
 */
export type LiveStatus = "before" | "active" | "after";

/** The pure resolver output for one instant. */
export interface LiveState {
  status: LiveStatus;
  nowMs: number;
  current: SegmentRef | null;
  next: SegmentRef | null;
  /** ms remaining in the live segment; 0 unless `status === "active"`. */
  remainingMs: number;
  /** ms wasted in the live segment (now − start); 0 unless `status === "active"`. */
  wastedMs: number;
  /** planned ms of the live segment (end − start); 0 unless `status === "active"`. */
  totalMs: number;
}

/**
 * Flatten a derived week schedule into absolute, UTC-normalized segment
 * references, Monday-first, sorted by start time.
 */
export function getSegmentRefs(
  schedule: Record<DayOfWeek, DaySchedule>,
  timezone: string,
  weekStart: LocalDate,
): SegmentRef[] {
  const refs: SegmentRef[] = [];
  WEEKDAY_NAMES.forEach((day, index) => {
    const localDate = addDays(weekStart, index);
    for (const segment of schedule[day]?.segments ?? []) {
      refs.push({
        day,
        segment,
        startMs: localMinutesToUtc(timezone, localDate, segment.start),
        endMs: localMinutesToUtc(timezone, localDate, segment.end),
      });
    }
  });
  refs.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return refs;
}

/**
 * (schedule, now) → liveState. Pure wall-clock resolver over the derived
 * schedule. `now` is an absolute instant; the week is anchored to the Monday
 * of the week containing `now` in `timezone`.
 */
export function resolveLiveState(
  schedule: Record<DayOfWeek, DaySchedule>,
  now: Date | number,
  timezone: string,
): LiveState {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const weekStart = getWeekStartDate(timezone, nowMs);
  const refs = getSegmentRefs(schedule, timezone, weekStart);

  const current =
    refs.find((r) => r.startMs <= nowMs && nowMs < r.endMs) ?? null;
  const next = refs.find((r) => r.startMs > nowMs) ?? null;

  if (current !== null) {
    return {
      status: "active",
      nowMs,
      current,
      next,
      remainingMs: current.endMs - nowMs,
      wastedMs: nowMs - current.startMs,
      totalMs: current.endMs - current.startMs,
    };
  }

  if (next !== null) {
    return {
      status: "before",
      nowMs,
      current: null,
      next,
      remainingMs: 0,
      wastedMs: 0,
      totalMs: 0,
    };
  }

  return {
    status: "after",
    nowMs,
    current: null,
    next: null,
    remainingMs: 0,
    wastedMs: 0,
    totalMs: 0,
  };
}
