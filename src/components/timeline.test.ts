import { describe, expect, it } from "vitest";
import {
  emptyTimelinePlacement,
  shiftTimelineSpan,
  splitTimelineSpan,
  snapTimelineMinutes,
  timelineMinutesAt,
  timelineBlockStyle,
  timelinePercent,
} from "./timeline";

describe("shared timeline geometry", () => {
  it("places a one-hour span proportionally on the 24-hour scale", () => {
    const style = timelineBlockStyle({ start: 120, end: 180 });
    expect(Number.parseFloat(style.top)).toBeCloseTo(8.3333, 3);
    expect(Number.parseFloat(style.height)).toBeCloseTo(4.1667, 3);
  });

  it("keeps duration proportional rather than applying a display minimum", () => {
    expect(timelinePercent(60)).toBeCloseTo(4.1667, 3);
    expect(timelinePercent(120)).toBeCloseTo(8.3333, 3);
  });

  it("splits wrapping sleep across the visible midnight boundary", () => {
    expect(splitTimelineSpan(1380, 420)).toEqual([
      { start: 1380, end: 1440 },
      { start: 0, end: 420 },
    ]);
  });

  it("does not render zero-length spans", () => {
    expect(splitTimelineSpan(600, 600)).toEqual([]);
  });

  it("snaps pointer placements to the nearest 15-minute boundary", () => {
    expect(snapTimelineMinutes(542)).toBe(540);
    expect(snapTimelineMinutes(548)).toBe(555);
    expect(snapTimelineMinutes(-10)).toBe(0);
    expect(snapTimelineMinutes(1450)).toBe(1440);
  });

  it("maps pointer coordinates to the shared timeline scale", () => {
    expect(timelineMinutesAt(250, { top: 100, height: 960 })).toBe(225);
    expect(timelineMinutesAt(50, { top: 100, height: 960 })).toBe(0);
    expect(timelineMinutesAt(1200, { top: 100, height: 960 })).toBe(1440);
  });

  it("preserves a forward span while keeping it inside the Week day", () => {
    expect(shiftTimelineSpan(540, 600, 1380)).toEqual({
      start: 1380,
      end: 1440,
    });
    expect(shiftTimelineSpan(540, 600, -30)).toEqual({
      start: 0,
      end: 60,
    });
  });

  it("preserves a wrapping sleep span when the start crosses midnight", () => {
    expect(shiftTimelineSpan(1380, 420, 60)).toEqual({
      start: 60,
      end: 540,
    });
  });

  it("provides a snapped one-hour placement for an empty slot", () => {
    expect(emptyTimelinePlacement(548)).toEqual({ start: 555, end: 615 });
    expect(emptyTimelinePlacement(1440)).toEqual({ start: 1380, end: 1440 });
  });
});
