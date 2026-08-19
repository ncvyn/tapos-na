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
} from "./components/timeline";

/** Resolve a pointer move after preserving the pointer's grab offset. */
export function resolvePointerMove(
  day: Day,
  item: DayItem,
  pointerMinute: number,
  grabOffset: number,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  const rawStart = pointerMinute - grabOffset;
  const requestedStart = item.start > item.end
    ? snapTimelineMinutes(((rawStart % 1440) + 1440) % 1440)
    : snapTimelineMinutes(rawStart);
  const shifted = shiftTimelineSpan(item.start, item.end, requestedStart);
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
