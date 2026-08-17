/**
 * Collision-prevention core (pure, deterministic, TDD).
 *
 * Decides whether a dragged item can be placed at a proposed time/day without
 * overlapping an existing block. The occupying-block model is exactly the one
 * the occupancy module supplies to the scheduling engine, so a
 * refused drop is precisely a placement that would break scheduling
 * constraints: "no overlapping blocks".
 *
 * Rules:
 * 1. A placement overlaps any effective block (template busy, one-off items,
 *    template/override sleep) → refused. Back-to-back (touching) is allowed.
 * 2. Sleep spans may wrap midnight; forward spans may not.
 * 3. Moving an item within its source day excludes that item from the check.
 */

import { type Day, type DayItem } from "./schema";
import {
  getWeekDayOccupancy,
  spansOverlap,
  type Span,
} from "./occupancy";

/** The draggable day-item kinds (todos are not day-pinned). */
export type ItemTag = DayItem["_tag"];

/** Duration of a span in minutes, accounting for a midnight wrap. */
export function spanLength(span: Span): number {
  const len = span.end - span.start;
  return len < 0 ? len + 1440 : len;
}

/**
 * The span an item would occupy if dragged so it starts at `newStart`,
 * preserving its duration.
 *
 * Busy/event spans are forward-only (the schema rejects inverted spans), so a
 * move that would push the end past midnight returns `null`. Sleep spans are
 * allowed to wrap and wrap around when the end crosses 1440.
 */
export function spanForNewStart(
  tag: ItemTag,
  original: Span,
  newStart: number,
): Span | null {
  const duration = spanLength(original);
  if (duration <= 0) return null;

  if (tag === "sleep") {
    const end = (newStart + duration) % 1440;
    if (newStart === end) return null;
    return { start: newStart, end };
  }

  const end = newStart + duration;
  if (end > 1440 || end <= newStart) return null;
  return { start: newStart, end };
}

/** A proposed placement on a day. */
export interface ProposedPlacement {
  tag: ItemTag;
  start: number;
  end: number;
}

/**
 * True when `placement` overlaps any occupying block on `day` — template busy
 * blocks, one-off items, and sleep windows (override if present, else
 * template). The moving item (identified by `movingId`) is excluded so it does
 * not collide with its own current position when dropped within its source day.
 */
export function wouldCollide(
  day: Day,
  placement: ProposedPlacement,
  movingId?: string,
): boolean {
  const blocks = getWeekDayOccupancy(day).effectiveBlocks.filter(
    (b) => b.id !== movingId,
  );
  return blocks.some((b) => spansOverlap(placement, b));
}
