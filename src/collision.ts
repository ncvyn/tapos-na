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

import { type BoundaryOccupancy, type Day, type DayItem } from "./schema";
import {
  getWeekDayOccupancy,
  spansOverlap,
} from "./occupancy";

/** The draggable day-item kinds (todos are not day-pinned). */
export type ItemTag = DayItem["_tag"];

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
  boundaryOccupancy: ReadonlyArray<BoundaryOccupancy> = [],
): boolean {
  const blocks = getWeekDayOccupancy(day, boundaryOccupancy).effectiveBlocks.filter(
    (b) => b.source === "boundary" || b.id !== movingId,
  );
  return blocks.some((b) => spansOverlap(placement, b));
}
