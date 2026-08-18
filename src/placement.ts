/**
 * Day item move resolution (pure, deterministic, TDD) — #19.
 *
 * The single shared placement-resolution behavior behind every Busy, Event,
 * and Sleep move through the Week-day drop surface. It decides where a moved
 * day item should land on its target Week day:
 *
 * 1. Preserve the requested wall-clock span exactly when it does not collide.
 * 2. Otherwise, shorten from the requested start (keep the end fixed) as long
 *    as at least `MIN_PLACEMENT_MINUTES` remain.
 * 3. Otherwise, place the full span at the nearest non-colliding start on the
 *    target Week day, with later candidates winning ties.
 * 4. If no minimum 15-minute placement exists, refuse (`null`).
 *
 * Adjustment (steps 2–3) is only well-defined for forward spans; a wrapping
 * sleep that cannot be placed exactly is refused rather than silently reshaped
 * into a forward day-time span. The resolver consults only the supplied target
 * Week day — it never searches another Week day for a target-specific move.
 * Week-boundary occupancy participates as read-only occupancy on Monday.
 */

import type { BoundaryOccupancy, Day } from "./schema";
import { wouldCollide, type ItemTag } from "./collision";

/** The shortest placement a move resolution will produce. */
export const MIN_PLACEMENT_MINUTES = 15;

/** A requested move placement: the item's wall-clock span on the target day. */
export interface RequestedPlacement {
  tag: ItemTag;
  start: number;
  end: number;
}

/** The resolved span for the moved item. */
export interface ResolvedPlacement {
  start: number;
  end: number;
  /** True when the resolved span differs from the requested wall-clock span. */
  adjusted: boolean;
}

/** True when the span is forward (non-wrapping) within a single day. */
function isForward(start: number, end: number): boolean {
  return end > start;
}

/**
 * Resolve where `requested` should land on the target `day`.
 *
 * @returns the resolved span, or `null` when no 15-minute placement exists.
 */
export function resolvePlacement(
  day: Day,
  requested: RequestedPlacement,
  movingId?: string,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  // 1. Exact requested placement, preserving the wall-clock span.
  if (!collides(day, requested, movingId, boundaryOccupancy)) {
    return { start: requested.start, end: requested.end, adjusted: false };
  }

  // Adjustment is only well-defined for forward spans. A wrapping sleep that
  // collides is refused rather than reshaped into a forward day-time span.
  if (!isForward(requested.start, requested.end)) return null;

  // 2. Shorten from the requested start (end fixed), keeping >= 15 minutes.
  const shortened = shortenFromStart(day, requested, movingId, boundaryOccupancy);
  if (shortened !== null) return shortened;

  // 3. Nearest alternate start that fits the full span (later candidates win).
  //    A placement shorter than 15 minutes is never produced.
  const duration = requested.end - requested.start;
  if (duration >= MIN_PLACEMENT_MINUTES) {
    const alternate = nearestAlternateStart(
      day,
      requested,
      duration,
      movingId,
      boundaryOccupancy,
    );
    if (alternate !== null) return alternate;
  }

  // 4. No minimum 15-minute placement exists on the target day.
  return null;
}

function collides(
  day: Day,
  placement: RequestedPlacement,
  movingId: string | undefined,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): boolean {
  return wouldCollide(day, placement, movingId, boundaryOccupancy);
}

/**
 * Keep the requested end fixed and push the start forward as little as
 * possible so the item clears occupancy while retaining >= 15 minutes.
 */
function shortenFromStart(
  day: Day,
  requested: RequestedPlacement,
  movingId: string | undefined,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): ResolvedPlacement | null {
  const latestStart = requested.end - MIN_PLACEMENT_MINUTES;
  for (let start = requested.start; start <= latestStart; start += 1) {
    const candidate: RequestedPlacement = {
      tag: requested.tag,
      start,
      end: requested.end,
    };
    if (!collides(day, candidate, movingId, boundaryOccupancy)) {
      return { start, end: requested.end, adjusted: true };
    }
  }
  return null;
}

/**
 * Search the target Week day for the start closest to `requested.start` at
 * which the full `duration` fits without colliding; on equidistant candidates
 * the later start wins.
 */
function nearestAlternateStart(
  day: Day,
  requested: RequestedPlacement,
  duration: number,
  movingId: string | undefined,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): ResolvedPlacement | null {
  let best: { start: number; distance: number } | null = null;

  for (let start = 0; start + duration <= 1440; start += 1) {
    const candidate: RequestedPlacement = {
      tag: requested.tag,
      start,
      end: start + duration,
    };
    if (collides(day, candidate, movingId, boundaryOccupancy)) continue;

    const distance = Math.abs(start - requested.start);
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && start > best.start)
    ) {
      best = { start, distance };
    }
  }

  return best === null
    ? null
    : { start: best.start, end: best.start + duration, adjusted: true };
}
