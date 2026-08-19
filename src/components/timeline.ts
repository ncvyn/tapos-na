/** Pure geometry for the shared 00:00–24:00 calendar timeline. */

export const MINUTES_PER_DAY = 1440;

export interface TimelineSpan {
  start: number;
  end: number;
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
