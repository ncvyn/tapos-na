import { describe, expect, it } from "vitest";
import {
  splitTimelineSpan,
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
});
