import { WEEKDAY_NAMES, type CalendarDoc, type Day, type DayOfWeek } from "./schema";
import { getWeekDayOccupancy, spansOverlap, type EffectiveBlock } from "./occupancy";

export interface DayConflict {
  first: EffectiveBlock;
  second: EffectiveBlock;
}

export interface CalendarConflict extends DayConflict {
  day: DayOfWeek;
}

/** Find the first pair of effective blocks that overlaps on a Week day. */
export function findDayConflict(day: Day): DayConflict | null {
  const blocks = getWeekDayOccupancy(day).effectiveBlocks;
  for (let firstIndex = 0; firstIndex < blocks.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < blocks.length; secondIndex += 1) {
      const first = blocks[firstIndex];
      const second = blocks[secondIndex];
      if (spansOverlap(first, second)) return { first, second };
    }
  }
  return null;
}

/** Find the first conflict anywhere in a stored calendar document. */
export function findCalendarConflict(doc: CalendarDoc): CalendarConflict | null {
  for (const day of WEEKDAY_NAMES) {
    const conflict = findDayConflict(doc.days[day]);
    if (conflict) return { day, ...conflict };
  }
  return null;
}

function blockLabel(block: EffectiveBlock): string {
  return block.title ?? block._tag;
}

export function formatConflict(conflict: CalendarConflict | DayConflict, day?: DayOfWeek): string {
  const location = "day" in conflict ? conflict.day : day ?? "this day";
  return `Blocks overlap on ${location}: ${blockLabel(conflict.first)} and ${blockLabel(conflict.second)}.`;
}
