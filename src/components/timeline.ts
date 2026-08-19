/** Pure geometry for the shared 00:00–24:00 calendar timeline. */

export const MINUTES_PER_DAY = 1440;
export const TIMELINE_SNAP_MINUTES = 15;

export interface TimelineSpan {
  start: number;
  end: number;
}

/** Convert a pointer position into local wall-clock minutes on the timeline. */
export function timelineMinutesAt(
  clientY: number,
  rect: Pick<DOMRect, "top" | "height">,
): number {
  if (rect.height <= 0) return 0;
  return Math.round(
    Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) * MINUTES_PER_DAY,
  );
}

/** Snap a requested wall-clock minute to the nearest quarter hour. */
export function snapTimelineMinutes(minutes: number): number {
  return Math.max(
    0,
    Math.min(
      MINUTES_PER_DAY,
      Math.round(minutes / TIMELINE_SNAP_MINUTES) * TIMELINE_SNAP_MINUTES,
    ),
  );
}

/** Shift a span to a requested start while preserving its wall-clock duration. */
export function shiftTimelineSpan(
  originalStart: number,
  originalEnd: number,
  requestedStart: number,
): TimelineSpan {
  const wraps = originalStart > originalEnd;
  const duration = wraps
    ? originalEnd + MINUTES_PER_DAY - originalStart
    : originalEnd - originalStart;

  if (wraps) {
    const start = ((requestedStart % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return {
      start,
      end: (start + duration) % MINUTES_PER_DAY,
    };
  }

  const start = Math.max(0, Math.min(MINUTES_PER_DAY - duration, requestedStart));
  return { start, end: start + duration };
}

/** Split a wall-clock span into the non-wrapping pieces visible in a day. */
export function splitTimelineSpan(start: number, end: number): TimelineSpan[] {
  const boundedStart = Math.max(0, Math.min(MINUTES_PER_DAY, start));
  const boundedEnd = Math.max(0, Math.min(MINUTES_PER_DAY, end));

  if (boundedStart < boundedEnd) {
    return [{ start: boundedStart, end: boundedEnd }];
  }
  if (boundedStart > boundedEnd) {
    return [
      { start: boundedStart, end: MINUTES_PER_DAY },
      { start: 0, end: boundedEnd },
    ].filter((span) => span.start < span.end);
  }
  return [];
}

export function timelinePercent(minutes: number): number {
  return (Math.max(0, Math.min(MINUTES_PER_DAY, minutes)) / MINUTES_PER_DAY) * 100;
}

/** CSS positioning for a span; intentionally has no minimum height. */
export function timelineBlockStyle(span: TimelineSpan): {
  top: string;
  height: string;
} {
  return {
    top: `${timelinePercent(span.start)}%`,
    height: `${timelinePercent(span.end - span.start)}%`,
  };
}
