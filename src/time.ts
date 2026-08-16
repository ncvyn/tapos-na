/**
 * Time and timezone utilities for calendar rendering and DST-aware calculations.
 */

import { type DayOfWeek, WEEKDAY_NAMES } from "./schema";

const WEEKDAY_INDEX_MAP: Record<string, DayOfWeek> = {
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
};

/**
 * Get current day of week (in lower-case schema format) computed from
 * UTC timestamp and stored IANA timezone.
 *
 * DST-aware: leverages Intl.DateTimeFormat with target timezone to resolve
 * local weekday directly.
 */
export function getTodayWeekday(
  timezone: string,
  now: Date | number = new Date(),
): DayOfWeek {
  const date = typeof now === "number" ? new Date(now) : now;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
    });
    const weekdayString = formatter.format(date);
    const day = WEEKDAY_INDEX_MAP[weekdayString];
    return day ?? "monday";
  } catch {
    // Fallback to UTC if timezone is invalid
    try {
      const utcFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "long",
      });
      const weekdayString = utcFormatter.format(date);
      return WEEKDAY_INDEX_MAP[weekdayString] ?? "monday";
    } catch {
      return "monday";
    }
  }
}

/**
 * Format minutes from midnight (0..1440) as "HH:MM".
 */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Parse "HH:MM" time string into minutes from midnight (0..1440).
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(":")) return 0;
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, Math.min(1440, h * 60 + m));
}

/**
 * Format time span with human readable duration.
 * Supports cross-midnight spans (e.g. 23:00 to 07:00).
 */
export function formatTimeSpan(startMin: number, endMin: number): string {
  const startStr = minutesToTime(startMin);
  const endStr = minutesToTime(endMin);

  let durationMin = endMin - startMin;
  if (durationMin < 0) {
    // Crosses midnight
    durationMin += 1440;
  }

  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;

  let durationText = "";
  if (hours > 0 && mins > 0) {
    durationText = `${hours}h ${mins}m`;
  } else if (hours > 0) {
    durationText = `${hours}h`;
  } else {
    durationText = `${mins}m`;
  }

  return `${startStr} – ${endStr} (${durationText})`;
}

/**
 * Returns weekday names ordered according to user's weekStart setting.
 */
export function getDisplayDays(
  weekStart: "monday" | "sunday",
): readonly DayOfWeek[] {
  if (weekStart === "sunday") {
    return [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ] as const;
  }
  return WEEKDAY_NAMES;
}
