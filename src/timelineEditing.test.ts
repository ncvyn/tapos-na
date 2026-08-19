import { describe, expect, it } from "vitest";
import type { Day, Busy } from "./schema";
import {
  keyboardMoveRequest,
  keyboardResizeValue,
  resolveKeyboardMove,
  resolveKeyboardResize,
  resolvePointerMove,
  resolvePointerResize,
} from "./timelineEditing";

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

describe("keyboard timeline editing seam", () => {
  it("moves a focused item by 15 minutes without changing its span", () => {
    const request = keyboardMoveRequest("monday", item, "ArrowDown");
    expect(request).toEqual({
      targetDay: "monday",
      start: 555,
      end: 615,
    });
    expect(resolveKeyboardMove(createDay(), item, request!)).toEqual({
      start: 555,
      end: 615,
      adjusted: false,
    });
  });

  it("moves between Week days with Shift plus horizontal arrows", () => {
    expect(keyboardMoveRequest("monday", item, "ArrowRight", true)).toEqual({
      targetDay: "tuesday",
      start: 540,
      end: 600,
    });
    expect(keyboardMoveRequest("monday", item, "ArrowLeft", true)).toBeNull();
  });

  it("refuses a timed move beyond the day boundary", () => {
    const lateItem = { ...item, start: 1380, end: 1440 };
    expect(keyboardMoveRequest("monday", lateItem, "ArrowDown")).toBeNull();
  });

  it("adjusts keyboard moves through the shared placement resolver", () => {
    const day = createDay({
      template: {
        busy: [{ id: "class", title: "Class", start: 555, end: 585 }],
        sleep: [],
      },
    });
    const request = keyboardMoveRequest("monday", item, "ArrowDown");
    expect(resolveKeyboardMove(day, item, request!)).toEqual({
      start: 585,
      end: 615,
      adjusted: true,
    });
  });

  it("changes the selected resize edge by 15 minutes", () => {
    expect(keyboardResizeValue(item, "end", "ArrowDown")).toBe(615);
    expect(keyboardResizeValue(item, "start", "ArrowUp")).toBe(525);
    expect(resolveKeyboardResize(createDay(), item, "end", "ArrowDown")).toEqual({
      start: 540,
      end: 615,
      adjusted: false,
    });
  });

  it("uses the resize resolver's minimum-duration and collision rules", () => {
    const shortItem = { ...item, start: 540, end: 555 };
    expect(resolveKeyboardResize(createDay(), shortItem, "end", "ArrowUp")).toBeNull();

    const day = createDay({
      template: {
        busy: [{ id: "class", title: "Class", start: 605, end: 630 }],
        sleep: [],
      },
    });
    expect(resolveKeyboardResize(day, item, "end", "ArrowDown")).toEqual({
      start: 540,
      end: 605,
      adjusted: true,
    });
  });
});
