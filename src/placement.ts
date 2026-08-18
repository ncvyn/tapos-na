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

import type { BoundaryOccupancy, Day, DayOfWeek } from "./schema";
import { wouldCollide, type ItemTag } from "./collision";

/** The shortest placement a move resolution will produce. */
export const MIN_PLACEMENT_MINUTES = 15;

/** The single refusal message surfaced when a day has no valid placement. */
export function refusalMessage(day: DayOfWeek): string {
  return `No 15-minute placement on ${day} — move refused.`;
}

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

// ---------------------------------------------------------------------------
// Resize resolution (#20)
// ---------------------------------------------------------------------------

/** The edge of a day item being resized. */
export type ResizeEdge = "start" | "end";

/** The item being resized, as it currently sits on its Week day. */
export interface ResizeRequest {
  tag: ItemTag;
  start: number;
  end: number;
  /** The resized item's id — excluded from its own occupancy check. */
  id?: string;
}

/** A requested resize: move the active edge to `value`, keep the other fixed. */
export interface ResizeTarget {
  edge: ResizeEdge;
  value: number;
}

/**
 * Resolve a resize of a day item. The opposite edge stays fixed; the active
 * edge is clamped to the first conflicting occupancy boundary rather than
 * creating an overlap, and any result shorter than 15 minutes is refused
 * (`null`). Wrapping Sleep resizes preserve the item's start and shorten the
 * trailing (post-midnight) portion first when required. The source span is
 * never mutated — the caller applies the resolved span on success.
 */
export function resolveResize(
  day: Day,
  current: ResizeRequest,
  target: ResizeTarget,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): ResolvedPlacement | null {
  if (current.start > current.end) {
    return resolveWrappingSleepResize(day, current, target, boundaryOccupancy);
  }
  return resolveForwardResize(day, current, target, boundaryOccupancy);
}

/** Resize a forward (non-wrapping) span: keep one edge, clamp the other. */
function resolveForwardResize(
  day: Day,
  current: ResizeRequest,
  target: ResizeTarget,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): ResolvedPlacement | null {
  const edge = target.edge;
  const fixed = edge === "start" ? current.end : current.start;
  const currentActive = edge === "start" ? current.start : current.end;

  // Growing the span moves the active edge away from the fixed edge.
  const extending =
    edge === "start"
      ? target.value < currentActive
      : target.value > currentActive;

  const active = extending
    ? clampActiveEdge(day, current, edge, fixed, currentActive, target.value, boundaryOccupancy)
    : target.value;

  // A resize that cannot move the active edge at all (it clamps back to the
  // original edge) is refused rather than persisting an unchanged span.
  if (extending && active === currentActive) return null;

  const newStart = edge === "start" ? active : fixed;
  const newEnd = edge === "start" ? fixed : active;

  // A forward span must stay forward and retain at least 15 minutes.
  if (newEnd <= newStart) return null;
  if (newEnd - newStart < MIN_PLACEMENT_MINUTES) return null;
  if (wouldCollide(day, { tag: current.tag, start: newStart, end: newEnd }, current.id, boundaryOccupancy)) {
    return null;
  }

  return { start: newStart, end: newEnd, adjusted: active !== target.value };
}

/**
 * Clamp the active edge when extending it into occupancy: return the first
 * value (scanning back toward the known-safe `currentActive`) at which the
 * span no longer collides — the first conflicting occupancy boundary.
 */
function clampActiveEdge(
  day: Day,
  current: ResizeRequest,
  edge: ResizeEdge,
  fixed: number,
  currentActive: number,
  value: number,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): number {
  const step = edge === "start" ? 1 : -1;
  for (let active = value; ; active += step) {
    if (edge === "start" && active > currentActive) return currentActive;
    if (edge === "end" && active < currentActive) return currentActive;
    const candidate = edge === "start"
      ? { start: active, end: fixed }
      : { start: fixed, end: active };
    if (
      !wouldCollide(day, { tag: current.tag, ...candidate }, current.id, boundaryOccupancy)
    ) {
      return active;
    }
  }
}

/**
 * Resize a wrapping Sleep span. The start is preserved; only the trailing
 * (post-midnight) portion is adjustable, clamped to occupancy and shortened
 * first when required. A start-edge request, a span that stops wrapping, or a
 * result shorter than 15 minutes is refused (`null`).
 */
function resolveWrappingSleepResize(
  day: Day,
  current: ResizeRequest,
  target: ResizeTarget,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): ResolvedPlacement | null {
  if (target.edge !== "end") return null;
  const start = current.start;
  const currentEnd = current.end;

  // Must still wrap midnight.
  if (target.value >= start) return null;

  const extending = target.value > currentEnd;
  const end = extending
    ? clampWrappingEnd(day, current, target.value, boundaryOccupancy)
    : target.value;

  // A wrapping-sleep resize that cannot move the trailing edge at all is
  // refused rather than persisting an unchanged span.
  if (extending && end === currentEnd) return null;

  const duration = end - start + 1440;
  if (duration < MIN_PLACEMENT_MINUTES) return null;
  if (wouldCollide(day, { tag: current.tag, start, end }, current.id, boundaryOccupancy)) {
    return null;
  }

  return { start, end, adjusted: end !== target.value };
}

/** Clamp the trailing end of a wrapping sleep back to the first clear boundary. */
function clampWrappingEnd(
  day: Day,
  current: ResizeRequest,
  value: number,
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy>,
): number {
  const start = current.start;
  for (let end = value; ; end -= 1) {
    if (end <= current.end) return current.end;
    if (
      !wouldCollide(day, { tag: current.tag, start, end }, current.id, boundaryOccupancy)
    ) {
      return end;
    }
  }
}
