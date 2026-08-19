import { describe, expect, it } from "vitest";
import type { Day, Busy } from "./schema";
import { resolvePointerMove, resolvePointerResize } from "./timelineEditing";

function createDay(partial: Partial<Day> = {}): Day {
  return {
    template: { busy: [], sleep: [] },
    items: [],
    ...partial,
  };
}

const item: Busy = {
  _tag: "busy",
  id: "busy-1",
  title: "Lecture",
  day: "monday",
  start: 540,
  end: 600,
};

describe("pointer timeline editing seam", () => {
  it("keeps the pointer grab offset while snapping a move", () => {
    expect(resolvePointerMove(createDay(), item, 700, 20)).toEqual({
      start: 675,
      end: 735,
      adjusted: false,
    });
  });

  it("previews a resolver-shortened move", () => {
    const day = createDay({
      template: {
        busy: [{ id: "class", title: "Class", start: 660, end: 690 }],
        sleep: [],
      },
    });
    expect(resolvePointerMove(day, item, 680, 0)).toEqual({
      start: 690,
      end: 735,
      adjusted: true,
    });
  });

  it("snaps a resize and keeps the resolver's refusal intact", () => {
    expect(resolvePointerResize(createDay(), item, "end", 718)).toEqual({
      start: 540,
      end: 720,
      adjusted: false,
    });

    const fullDay = createDay({
      items: [{ ...item, id: "wall", start: 0, end: 1440 }],
    });
    expect(resolvePointerResize(fullDay, item, "end", 720)).toBeNull();
  });
});
