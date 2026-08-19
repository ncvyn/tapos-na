/**
 * Time and timezone utilities for calendar rendering and DST-aware calculations.
 */

import { type DayOfWeek, type WeekIdentity } from "./schema";

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

// ---------------------------------------------------------------------------
// Zoned-time primitives (DST-aware)
// ---------------------------------------------------------------------------

/**
 * A calendar date in a timezone, expressed as local (wall-clock) parts.
 */
export interface LocalDate {
  year: number;
  month: number; // 1–12
  day: number;
}

/** Local wall-clock time parts, without timezone context. */
export interface LocalClockTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface ZonedParts extends LocalClockTime {
  weekday: number; // 0 = Sunday … 6 = Saturday
}

/** One zoned formatter serves every helper: resolution, formatting, anchoring. */
function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Local wall-clock parts (and weekday) of an instant in a timezone. */
function formatParts(timezone: string, date: Date): ZonedParts {
  const parts = zonedFormatter(timezone).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday,
  };
}

/**
 * Resolve a local wall-clock time in an IANA timezone to an absolute UTC
 * instant (ms). Iterative and DST-aware: it converges by repeatedly
 * formatting a guess and correcting by the wall-clock delta, which yields
 * the correct offset even on days with a transition. For ambiguous local
 * times (the repeated fall-back hour) it converges to the earlier — first —
 * occurrence, so a schedule anchors to that pass.
 */
export function zonedTimeToUtc(
  timezone: string,
  local: LocalClockTime,
): number {
  const targetLocalMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const formatter = zonedFormatter(timezone);
  let guess = targetLocalMs;
  for (let i = 0; i < 4; i += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "0";
    const currentLocalMs = Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(get("hour")),
      Number(get("minute")),
      Number(get("second")),
    );
    const diff = targetLocalMs - currentLocalMs;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}

/**
 * The Monday (local, in `timezone`) of the week containing `now` — the week
 * the doc represents.
 */
export function getWeekStartDate(
  timezone: string,
  now: Date | number,
): LocalDate {
  const { year, month, day, weekday } = formatParts(
    timezone,
    typeof now === "number" ? new Date(now) : now,
  );
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - ((weekday + 6) % 7));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/** Format a local date as the canonical Week identity. */
export function formatLocalDate(date: LocalDate): WeekIdentity {
  return `${date.year.toString().padStart(4, "0")}-${date.month
    .toString()
    .padStart(2, "0")}-${date.day.toString().padStart(2, "0")}` as WeekIdentity;
}

/** Get the local Monday identity for the Week containing an instant. */
export function getWeekIdentity(
  timezone: string,
  now: Date | number = new Date(),
): WeekIdentity {
  return formatLocalDate(getWeekStartDate(timezone, now));
}

/** Shift a local calendar date by whole days (DST-free arithmetic). */
export function addDays(local: LocalDate, days: number): LocalDate {
  const utc = new Date(Date.UTC(local.year, local.month - 1, local.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/** Minutes from local midnight in a timezone → absolute UTC instant (ms). */
export function localMinutesToUtc(
  timezone: string,
  localDate: LocalDate,
  minutes: number,
): number {
  const totalSeconds = Math.floor(minutes * 60);
  return zonedTimeToUtc(timezone, {
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour: Math.floor(totalSeconds / 3600),
    minute: Math.floor((totalSeconds % 3600) / 60),
    second: totalSeconds % 60,
  });
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
 * Format the current wall-clock time in a timezone as 24-hour "HH:MM:SS".
 * DST-aware: leverages Intl.DateTimeFormat with the target timezone. Used by
 * the 1-second clock bar.
 */
export function getZonedClockTime(
  timezone: string,
  now: Date | number = new Date(),
): string {
  const date = typeof now === "number" ? new Date(now) : now;
  try {
    return zonedClockFormat(timezone, date);
  } catch {
    // Fallback to UTC if timezone is invalid
    return zonedClockFormat("UTC", date);
  }
}

function zonedClockFormat(timezone: string, date: Date): string {
  const parts = zonedFormatter(timezone).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return `${get("hour")}:${get("minute")}:${get("second")}`;
}
