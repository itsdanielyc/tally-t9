// L1: calendar dates as strings; "today" is the local date.
import { describe, expect, it } from "vitest";
import { daysInMonth, isValidDate, isValidMonth, localToday, monthOf } from "../../core/dates";

describe("dates", () => {
  it.each(["2024-02-29", "2026-01-31", "2000-02-29", "1999-12-31"])("%s is a real date", (d) => {
    expect(isValidDate(d)).toBe(true);
  });

  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-5", "26-01-05", "", "2026-01-05T00:00"])(
    "%j is not",
    (d) => {
      expect(isValidDate(d)).toBe(false);
    },
  );

  it("knows month lengths and leap years", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2024, m))).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it("takes today from the local calendar, not UTC", () => {
    // 23:30 local on 31 December is still 31 December, whatever UTC says.
    expect(localToday(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
    expect(localToday(new Date(2026, 0, 1, 0, 15))).toBe("2026-01-01");
  });

  it("reads months", () => {
    expect(monthOf("2026-03-15")).toBe("2026-03");
    expect(isValidMonth("2026-03")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
  });
});
