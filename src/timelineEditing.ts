/** Pure pointer-editing calculations for the shared timeline. */

import type { BoundaryOccupancy, Day, DayItem } from "./schema";
import {
  resolvePlacement,
  resolveResize,
  type ResolvedPlacement,
  type ResizeEdge,
} from "./placement";
import {
  shiftTimelineSpan,
  snapTimelineMinutes,
  type TimelineSpan,
} from "./components/timeline";

/** Calculate the requested wall-clock span for a grabbed pointer move. */
export function pointerMoveSpan(
  item: DayItem,
  pointerMinute: number,
  grabOffset: number,
): TimelineSpan {
  const rawStart = pointerMinute - grabOffset;
  const requestedStart = item.start > item.end
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
