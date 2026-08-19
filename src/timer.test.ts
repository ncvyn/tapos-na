/**
 * Timer core unit tests (T8).
 * Pure, deterministic tests for the wall-clock resolver seam:
 * (schedule, now) → liveState.
 */

import { describe, expect, it } from "vitest";
import { computeSchedule, type DaySchedule, type WorkSegment } from "./engine";
import { type CalendarDoc, type DayOfWeek, WEEKDAY_NAMES } from "./schema";
import { createDefaultDoc } from "./storage";
import { getWeekStartDate } from "./time";
import { getSegmentRefs, resolveLiveState } from "./timer";

const MS_MIN = 60_000;

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** A week with no segments scheduled on any day. */
function emptySchedule(): Record<DayOfWeek, DaySchedule> {
  const schedule = {} as Record<DayOfWeek, DaySchedule>;
  for (const day of WEEKDAY_NAMES) {
    schedule[day] = { freeSpans: [], segments: [] };
  }
  return schedule;
}

function workSeg(start: number, end: number): WorkSegment {
  return {
    _tag: "work",
    todoId: "t1",
    todoTitle: "Task",
    priority: "P0",
    start,
    end,
    pomodoroNumber: 1,
    isMiniFocus: false,
    count: 1,
  };
}

/**
 * A UTC doc whose Monday is free from 08:00 with a 2-pomodoro P0 todo, so the
 * derived Monday schedule is: work 480–505 (08:00), break 505–510, work
 * 510–535, break 535–540.
 */
function makeUtcWeekSchedule(): Record<DayOfWeek, DaySchedule> {
  const base = createDefaultDoc("UTC");
  const doc: CalendarDoc = {
    ...base,
    days: {
      ...base.days,
      monday: {
        template: { busy: [], sleep: [{ id: "s-mon", start: 0, end: 480 }] },
        items: [],
      },
    },
    todos: [
      {
        _tag: "todo",
        id: "t1",
        title: "Deep Work",
        pomodoros: 2,
        priority: "P0",
      },
    ],
  };
  return computeSchedule(doc);
}

// ---------------------------------------------------------------------------
// Live state: current segment, remaining, wasted
// ---------------------------------------------------------------------------

describe("resolveLiveState — (schedule, now) → liveState", () => {
  it("resolves the live segment with remaining = end − now and wasted = now − start (10 min late → 15 left, 10 wasted)", () => {
    const schedule = makeUtcWeekSchedule();
    // 2026-08-10 is a Monday; work #1 runs 08:00–08:25 UTC.
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T08:10:00Z"),
      "UTC",
    );

    expect(state.status).toBe("active");
    expect(state.current?.segment._tag).toBe("work");
    expect(state.current?.segment).toMatchObject({
      todoTitle: "Deep Work",
      pomodoroNumber: 1,
    });
    expect(state.current?.startMs).toBe(Date.UTC(2026, 7, 10, 8, 0, 0));
    expect(state.current?.endMs).toBe(Date.UTC(2026, 7, 10, 8, 25, 0));
    expect(state.remainingMs).toBe(15 * MS_MIN);
    expect(state.wastedMs).toBe(10 * MS_MIN);
    expect(state.totalMs).toBe(25 * MS_MIN);
  });

  it("is 'before' with the next segment until the first segment starts", () => {
    const schedule = makeUtcWeekSchedule();
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T07:59:59Z"),
      "UTC",
    );

    expect(state.status).toBe("before");
    expect(state.current).toBeNull();
    expect(state.next?.segment._tag).toBe("work");
    expect(state.next?.startMs).toBe(Date.UTC(2026, 7, 10, 8, 0, 0));
    expect(state.remainingMs).toBe(0);
    expect(state.wastedMs).toBe(0);
  });

  it("auto-starts exactly at the scheduled start (full remaining, zero wasted)", () => {
    const schedule = makeUtcWeekSchedule();
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T08:00:00Z"),
      "UTC",
    );

    expect(state.status).toBe("active");
    expect(state.current?.segment._tag).toBe("work");
    expect(state.remainingMs).toBe(25 * MS_MIN);
    expect(state.wastedMs).toBe(0);
  });

  it("advances to the next segment exactly at the segment boundary", () => {
    const schedule = makeUtcWeekSchedule();
    // Work #1 ends at 08:25; the short break 08:25–08:30 takes over.
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T08:25:00Z"),
      "UTC",
    );

    expect(state.status).toBe("active");
    expect(state.current?.segment._tag).toBe("break");
    expect(state.current?.segment).toMatchObject({
      breakType: "short",
      start: 505,
      end: 510,
    });
    expect(state.remainingMs).toBe(5 * MS_MIN);
    expect(state.wastedMs).toBe(0);
  });

  it("tracks wasted only for the live segment — a late first start doesn't carry into the next segment", () => {
    const schedule = makeUtcWeekSchedule();
    // Work #2 runs 08:30–08:55; at 08:35 five minutes have already passed.
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T08:35:00Z"),
      "UTC",
    );

    expect(state.status).toBe("active");
    expect(state.current?.segment).toMatchObject({
      _tag: "work",
      pomodoroNumber: 2,
    });
    expect(state.remainingMs).toBe(20 * MS_MIN);
    expect(state.wastedMs).toBe(5 * MS_MIN);
  });

  it("is 'after' once the week's last segment has ended", () => {
    const schedule = makeUtcWeekSchedule();
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T09:00:00Z"),
      "UTC",
    );

    expect(state.status).toBe("after");
    expect(state.current).toBeNull();
    expect(state.next).toBeNull();
  });

  it("resolves fractional (mini-focus) segment times at minute/second precision", () => {
    const schedule = emptySchedule();
    schedule.monday = {
      freeSpans: [],
      segments: [{ ...workSeg(512.5, 537.5), isMiniFocus: true, count: 0.5 }],
    };
    // 08:32:30–08:57:30 UTC on Monday 2026-08-10.
    const state = resolveLiveState(
      schedule,
      new Date("2026-08-10T08:37:30Z"),
      "UTC",
    );

    expect(state.status).toBe("active");
    expect(state.current?.startMs).toBe(Date.UTC(2026, 7, 10, 8, 32, 30));
    expect(state.current?.endMs).toBe(Date.UTC(2026, 7, 10, 8, 57, 30));
    expect(state.remainingMs).toBe(20 * MS_MIN);
    expect(state.wastedMs).toBe(5 * MS_MIN);
  });
});

// ---------------------------------------------------------------------------
// DST & zone edges
// ---------------------------------------------------------------------------

describe("resolveLiveState — DST & zone edges", () => {
  it("computes real elapsed time across the DST fall-back (a wall-clock 2h span is 3 real hours)", () => {
    const schedule = emptySchedule();
    // Sunday 01:00–03:00 (America/New_York) on fall-back day 2026-11-01.
    schedule.sunday = { freeSpans: [], segments: [workSeg(60, 180)] };

    // Fall-back at 2:00 EDT → 1:00 EST: 01:00 EDT = 05:00 UTC, 03:00 EST = 08:00 UTC.
    const state = resolveLiveState(
      schedule,
      new Date("2026-11-01T06:30:00Z"),
      "America/New_York",
    );

    expect(state.status).toBe("active");
    expect(state.current?.startMs).toBe(Date.UTC(2026, 10, 1, 5, 0, 0));
    expect(state.current?.endMs).toBe(Date.UTC(2026, 10, 1, 8, 0, 0));
    expect(state.totalMs).toBe(3 * 60 * MS_MIN);
    expect(state.remainingMs).toBe(90 * MS_MIN);
    expect(state.wastedMs).toBe(90 * MS_MIN);
  });

  it("resolves segments on the DST spring-forward day to the post-transition offset", () => {
    const schedule = emptySchedule();
    // Sunday 10:00–10:25 (America/New_York) on spring-forward day 2026-03-08.
    schedule.sunday = { freeSpans: [], segments: [workSeg(600, 625)] };

    // 10:00 EDT = 14:00 UTC (transition at 2:00 EST → 3:00 EDT).
    const state = resolveLiveState(
      schedule,
      new Date("2026-03-08T14:10:00Z"),
      "America/New_York",
    );

    expect(state.status).toBe("active");
    expect(state.current?.startMs).toBe(Date.UTC(2026, 2, 8, 14, 0, 0));
    expect(state.current?.endMs).toBe(Date.UTC(2026, 2, 8, 14, 25, 0));
    expect(state.remainingMs).toBe(15 * MS_MIN);
    expect(state.wastedMs).toBe(10 * MS_MIN);
  });

  it("anchors the week per timezone — the same instant is Monday in Manila and Sunday in Los Angeles", () => {
    const instant = new Date("2026-08-16T23:59:00Z");

    expect(getWeekStartDate("Asia/Manila", instant)).toEqual({
      year: 2026,
      month: 8,
      day: 17,
    });
    expect(getWeekStartDate("America/Los_Angeles", instant)).toEqual({
      year: 2026,
      month: 8,
      day: 10,
    });
    expect(getWeekStartDate("UTC", instant)).toEqual({
      year: 2026,
      month: 8,
      day: 10,
    });

    // A Sunday 17:30–17:55 segment is upcoming in both zones but anchored to
    // each zone's own Sunday: Aug 16 in Los Angeles, Aug 23 in Manila.
    const schedule = emptySchedule();
    schedule.sunday = { freeSpans: [], segments: [workSeg(1050, 1075)] };

    const manila = resolveLiveState(schedule, instant, "Asia/Manila");
    expect(manila.status).toBe("before");
    expect(manila.next?.startMs).toBe(Date.UTC(2026, 7, 23, 9, 30, 0)); // Sun 17:30 PHT

    const la = resolveLiveState(schedule, instant, "America/Los_Angeles");
    expect(la.status).toBe("before");
    expect(la.next?.startMs).toBe(Date.UTC(2026, 7, 17, 0, 30, 0)); // Sun 17:30 PDT
  });

  it("anchors a wall-clock time in the repeated fall-back hour to the first pass (policy locked)", () => {
    const schedule = emptySchedule();
    // Sunday 01:30–01:55 (America/New_York) on fall-back day 2026-11-01.
    schedule.sunday = { freeSpans: [], segments: [workSeg(90, 115)] };

    // The hour 01:00–02:00 occurs twice; the resolver pins the segment to the
    // first (EDT) pass: 01:30 EDT = 05:30 UTC. A now in the first pass is live.
    const firstPass = resolveLiveState(
      schedule,
      new Date("2026-11-01T05:40:00Z"),
      "America/New_York",
    );
    expect(firstPass.status).toBe("active");
    expect(firstPass.current?.startMs).toBe(Date.UTC(2026, 10, 1, 5, 30, 0));
    expect(firstPass.remainingMs).toBe(15 * MS_MIN);

    // The same wall-clock time in the second (EST) pass — 06:40 UTC — sees the
    // segment as already ended: it is not re-scheduled into the repeated hour.
    const secondPass = resolveLiveState(
      schedule,
      new Date("2026-11-01T06:40:00Z"),
      "America/New_York",
    );
    expect(secondPass.status).toBe("after");
    expect(secondPass.current).toBeNull();
    expect(secondPass.next).toBeNull();
  });

  it("getSegmentRefs returns segments across the week sorted by absolute start", () => {
    const schedule = emptySchedule();
    schedule.monday = {
      freeSpans: [],
      segments: [workSeg(480, 505), workSeg(505, 510)],
    };
    schedule.wednesday = { freeSpans: [], segments: [workSeg(600, 625)] };

    const refs = getSegmentRefs(schedule, "UTC", {
      year: 2026,
      month: 8,
      day: 10,
    });

    expect(refs.map((r) => [r.day, r.segment.start])).toEqual([
      ["monday", 480],
      ["monday", 505],
      ["wednesday", 600],
    ]);
  });
});
