import { describe, expect, it } from "vitest";
import {
  formatTimeSpan,
  getDisplayDays,
  getTodayWeekday,
  minutesToTime,
  timeToMinutes,
} from "./time";

describe("Timezone & DST seam", () => {
  describe("getTodayWeekday", () => {
    it("resolves day of week in specified timezone correctly", () => {
      // 2026-03-08T03:30:00Z:
      // In UTC: Sunday 03:30
      // In America/New_York (UTC-5): Saturday 22:30
      // In Asia/Tokyo (UTC+9): Sunday 12:30
      const utcInstant = new Date("2026-03-08T03:30:00Z");

      expect(getTodayWeekday("UTC", utcInstant)).toBe("sunday");
      expect(getTodayWeekday("America/New_York", utcInstant)).toBe("saturday");
      expect(getTodayWeekday("Asia/Tokyo", utcInstant)).toBe("sunday");
    });

    it("resolves correctly across DST spring-forward transition", () => {
      // US Eastern springs forward at 2:00 AM on Sunday, March 8, 2026 (EST UTC-5 -> EDT UTC-4).
      // At 2026-03-08T06:59:00Z -> 01:59:00 EST (Sunday)
      // At 2026-03-08T07:01:00Z -> 03:01:00 EDT (Sunday)
      const beforeJump = new Date("2026-03-08T06:59:00Z");
      const afterJump = new Date("2026-03-08T07:01:00Z");

      expect(getTodayWeekday("America/New_York", beforeJump)).toBe("sunday");
      expect(getTodayWeekday("America/New_York", afterJump)).toBe("sunday");
    });

    it("resolves correctly across DST fall-back transition", () => {
      // US Eastern falls back at 2:00 AM on Sunday, November 1, 2026 (EDT UTC-4 -> EST UTC-5).
      // At 2026-11-01T05:59:00Z -> 01:59:00 EDT (Sunday)
      // At 2026-11-01T06:01:00Z -> 01:01:00 EST (Sunday)
      const beforeFallBack = new Date("2026-11-01T05:59:00Z");
      const afterFallBack = new Date("2026-11-01T06:01:00Z");

      expect(getTodayWeekday("America/New_York", beforeFallBack)).toBe("sunday");
      expect(getTodayWeekday("America/New_York", afterFallBack)).toBe("sunday");
    });

    it("handles midnight boundaries in different timezones", () => {
      // 2026-08-16T23:59:00Z (Sunday night UTC)
      // London (Europe/London, BST UTC+1 in August): Monday 00:59:00
      // Manila (Asia/Manila, UTC+8): Monday 07:59:00
      // Los Angeles (America/Los_Angeles, PDT UTC-7): Sunday 16:59:00
      const instant = new Date("2026-08-16T23:59:00Z");

      expect(getTodayWeekday("UTC", instant)).toBe("sunday");
      expect(getTodayWeekday("Europe/London", instant)).toBe("monday");
      expect(getTodayWeekday("Asia/Manila", instant)).toBe("monday");
      expect(getTodayWeekday("America/Los_Angeles", instant)).toBe("sunday");
    });

    it("defaults to UTC if timezone is invalid or unresolvable", () => {
      const instant = new Date("2026-08-16T12:00:00Z");
      expect(getTodayWeekday("Invalid/Timezone", instant)).toBe("sunday");
    });
  });

  describe("time formatting & parsing utilities", () => {
    it("converts minutes to HH:MM time strings", () => {
      expect(minutesToTime(0)).toBe("00:00");
      expect(minutesToTime(90)).toBe("01:30");
      expect(minutesToTime(540)).toBe("09:00");
      expect(minutesToTime(1439)).toBe("23:59");
      expect(minutesToTime(1440)).toBe("24:00");
    });

    it("converts HH:MM time strings to minutes from midnight", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("01:30")).toBe(90);
      expect(timeToMinutes("09:00")).toBe(540);
      expect(timeToMinutes("23:59")).toBe(1439);
      expect(timeToMinutes("24:00")).toBe(1440);
      expect(timeToMinutes("invalid")).toBe(0);
    });

    it("formats time span with readable duration", () => {
      expect(formatTimeSpan(540, 600)).toBe("09:00 – 10:00 (1h)");
      expect(formatTimeSpan(540, 630)).toBe("09:00 – 10:30 (1h 30m)");
      expect(formatTimeSpan(540, 585)).toBe("09:00 – 09:45 (45m)");
      // Cross midnight
      expect(formatTimeSpan(1380, 420)).toBe("23:00 – 07:00 (8h)");
    });
  });

  describe("getDisplayDays", () => {
    it("returns Monday-first days", () => {
      expect(getDisplayDays("monday")).toEqual([
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ]);
    });

    it("returns Sunday-first days", () => {
      expect(getDisplayDays("sunday")).toEqual([
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ]);
    });
  });
});
