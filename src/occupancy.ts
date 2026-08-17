/**
 * Week-day occupancy (pure, deterministic).
 *
 * Combines a day's recurring template, one-off items, and sleep override into
 * the effective blocks that occupy the day. The same projection supplies
 * normalized occupied intervals for collision/rendering and free spans for
 * schedule placement.
 */

import type { Day, DayItem } from "./schema";

/** A non-wrapping interval in minutes from local midnight. */
export interface Span {
  start: number;
  end: number;
}

/** A free interval in the day's [0, 1440] timeline. */
export type FreeSpan = Span;

/** Where an effective block came from. */
export type BlockSource = "template" | "one-off" | "override";

/** An item that occupies a Week day after template expansion. */
export interface EffectiveBlock {
  _tag: DayItem["_tag"];
  id: string;
  title?: string;
  start: number;
  end: number;
  source: BlockSource;
}

/** All occupancy projections for one Week day. */
export interface WeekDayOccupancy {
  effectiveBlocks: EffectiveBlock[];
  occupiedIntervals: Span[];
  freeSpans: FreeSpan[];
}

/**
 * Split a span into non-wrapping intervals within the day. A wrapping span
 * covers the tail of one day and the head of the next.
 */
export function toIntervals(span: Span): Span[] {
  if (span.start < span.end) return [span];
  if (span.start > span.end) {
    return [
      { start: span.start, end: 1440 },
      { start: 0, end: span.end },
    ];
  }
  return [];
}

/** Strict overlap; touching endpoints are allowed. */
export function spansOverlap(a: Span, b: Span): boolean {
  const aIntervals = toIntervals(a);
  const bIntervals = toIntervals(b);
  return aIntervals.some((x) =>
    bIntervals.some((y) => x.start < y.end && y.start < x.end),
  );
}

/**
 * Resolve all effective blocks and their derived occupied/free projections.
 * Effective blocks retain deterministic source order; intervals are sorted
 * and merged because their order is a scheduling invariant.
 */
export function getWeekDayOccupancy(day: Day): WeekDayOccupancy {
  const effectiveBlocks = expandEffectiveBlocks(day);
  const occupiedIntervals = mergeIntervals(
    effectiveBlocks.flatMap((block) =>
      (block._tag === "sleep"
        ? toIntervals(block)
        : block.start < block.end
          ? [{ start: block.start, end: block.end }]
          : []
      ).map(clampInterval),
    ),
  );

  return {
    effectiveBlocks,
    occupiedIntervals,
    freeSpans: invertIntervals(occupiedIntervals),
  };
}

function expandEffectiveBlocks(day: Day): EffectiveBlock[] {
  const blocks: EffectiveBlock[] = [];

  for (const block of day.template.busy) {
    blocks.push({
      _tag: "busy",
      id: block.id,
      title: block.title,
      start: block.start,
      end: block.end,
      source: "template",
    });
  }

  for (const item of day.items) {
    blocks.push(toEffectiveBlock(item));
  }

  if (day.sleepOverride !== undefined) {
    day.sleepOverride.forEach((block, index) => {
      blocks.push({
        _tag: "sleep",
        id: `override-${index}-${block.start}-${block.end}`,
        start: block.start,
        end: block.end,
        source: "override",
      });
    });
  } else {
    for (const block of day.template.sleep) {
      blocks.push({
        _tag: "sleep",
        id: block.id,
        start: block.start,
        end: block.end,
        source: "template",
      });
    }
  }

  return blocks;
}

function toEffectiveBlock(item: DayItem): EffectiveBlock {
  if (item._tag === "sleep") {
    return {
      _tag: "sleep",
      id: item.id,
      start: item.start,
      end: item.end,
      source: "one-off",
    };
  }

  return {
    _tag: item._tag,
    id: item.id,
    title: item.title,
    start: item.start,
    end: item.end,
    source: "one-off",
  };
}

function clampInterval(span: Span): Span {
  return {
    start: Math.max(0, Math.min(1440, span.start)),
    end: Math.max(0, Math.min(1440, span.end)),
  };
}

function mergeIntervals(intervals: Span[]): Span[] {
  const valid = intervals
    .filter((span) => span.start < span.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];

  for (const span of valid) {
    const last = merged[merged.length - 1];
    if (last === undefined || span.start > last.end) {
      merged.push({ ...span });
    } else {
      last.end = Math.max(last.end, span.end);
    }
  }

  return merged;
}

function invertIntervals(occupiedIntervals: Span[]): FreeSpan[] {
  const freeSpans: FreeSpan[] = [];
  let cursor = 0;

  for (const span of occupiedIntervals) {
    if (span.start > cursor) {
      freeSpans.push({ start: cursor, end: span.start });
    }
    cursor = Math.max(cursor, span.end);
  }

  if (cursor < 1440) {
    freeSpans.push({ start: cursor, end: 1440 });
  }

  return freeSpans;
}
