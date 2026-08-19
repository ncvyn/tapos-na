/** Pure pointer- and keyboard-editing calculations for the shared timeline. */

import {
  WEEKDAY_NAMES,
  type BoundaryOccupancy,
  type Day,
  type DayItem,
  type DayOfWeek,
} from "./schema";
import {
  resolvePlacement,
  resolveResize,
  type ResolvedPlacement,
  type ResizeEdge,
} from "./placement";
import {
  shiftTimelineSpan,
  type TimelineSpan,
  snapTimelineMinutes,
} from "./components/timeline";

/** Calculate the requested wall-clock span for a grabbed pointer move. */
export function pointerMoveSpan(
  item: DayItem,
  pointerMinute: number,
  grabOffset: number,
): TimelineSpan {
  const rawStart = pointerMinute - grabOffset;
  const requestedStart =
    item.start > item.end
      ? snapTimelineMinutes(((rawStart % 1440) + 1440) % 1440)
      : snapTimelineMinutes(rawStart);
  return shiftTimelineSpan(item.start, item.end, requestedStart);
}

/** Resolve a pointer move after preserving the pointer's grab offset. */
export function resolvePointerMove(
  day: Day,
  item: DayItem,
  pointerMinute: number,
  grabOffset: number,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  const shifted = pointerMoveSpan(item, pointerMinute, grabOffset);
  return resolvePlacement(
    day,
    { tag: item._tag, start: shifted.start, end: shifted.end },
    item.id,
    boundaryOccupancy,
  );
}

/** Resolve a pointer resize after snapping its active edge. */
export function resolvePointerResize(
  day: Day,
  item: DayItem,
  edge: ResizeEdge,
  pointerMinute: number,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  return resolveResize(
    day,
    { tag: item._tag, start: item.start, end: item.end, id: item.id },
    { edge, value: snapTimelineMinutes(pointerMinute) },
    boundaryOccupancy,
  );
}

export interface KeyboardMoveRequest extends TimelineSpan {
  targetDay: DayOfWeek;
}

/** Whether a key changes the active resize edge's wall-clock value. */
export function isKeyboardResizeKey(key: string): boolean {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight"
  );
}

/** Calculate a 15-minute move requested by a focused Day item. */
export function keyboardMoveRequest(
  sourceDay: DayOfWeek,
  item: DayItem,
  key: string,
  shiftKey = false,
): KeyboardMoveRequest | null {
  if (shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
    const dayIndex = WEEKDAY_NAMES.indexOf(sourceDay);
    const targetIndex = dayIndex + (key === "ArrowLeft" ? -1 : 1);
    const targetDay = WEEKDAY_NAMES[targetIndex];
    if (!targetDay) return null;
    return { targetDay, start: item.start, end: item.end };
  }

  if (shiftKey || (key !== "ArrowUp" && key !== "ArrowDown")) return null;

  const delta = key === "ArrowUp" ? -15 : 15;
  const requestedStart = item.start + delta;
  if (item.start > item.end) {
    return {
      targetDay: sourceDay,
      ...shiftTimelineSpan(item.start, item.end, requestedStart),
    };
  }

  const duration = item.end - item.start;
  if (requestedStart < 0 || requestedStart + duration > 1440) return null;
  return {
    targetDay: sourceDay,
    start: requestedStart,
    end: requestedStart + duration,
  };
}

/** Resolve a keyboard move against the same placement rules as pointer moves. */
export function resolveKeyboardMove(
  day: Day,
  item: DayItem,
  request: KeyboardMoveRequest,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  return resolvePlacement(
    day,
    { tag: item._tag, start: request.start, end: request.end },
    item.id,
    boundaryOccupancy,
  );
}

/** Calculate the next active edge value for keyboard resize mode. */
export function keyboardResizeValue(
  item: DayItem,
  edge: ResizeEdge,
  key: string,
): number | null {
  const delta =
    key === "ArrowUp" || key === "ArrowLeft"
      ? -15
      : key === "ArrowDown" || key === "ArrowRight"
        ? 15
        : null;
  if (delta === null) return null;
  const current = edge === "start" ? item.start : item.end;
  const value = current + delta;
  return value >= 0 && value <= 1440 ? value : null;
}

/** Resolve a keyboard resize against the same rules as pointer resizing. */
export function resolveKeyboardResize(
  day: Day,
  item: DayItem,
  edge: ResizeEdge,
  key: string,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  const value = keyboardResizeValue(item, edge, key);
  if (value === null) return null;
  return resolveResize(
    day,
    { tag: item._tag, start: item.start, end: item.end, id: item.id },
    { edge, value },
    boundaryOccupancy,
  );
}
