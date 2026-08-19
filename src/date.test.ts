import { describe, expect, it } from "vitest";
import { isTaskOverdue, normalizeTargetDate, periodRange, shiftDate, sortTasks, todayInIndia } from "./date";
import type { Task } from "./types";

const task = (overrides: Partial<Task>): Task => ({
  id: crypto.randomUUID(),
  title: "Task",
  dueDate: "2026-09-18",
  planType: "Daily",
  priority: "Medium",
  status: "Open",
  completedAt: null,
  overdue: false,
  ...overrides,
});

describe("planner dates", () => {
  it("uses Monday through Sunday for week ranges", () => {
    expect(periodRange("2026-09-18", "week")).toEqual({ start: "2026-09-14", end: "2026-09-20" });
  });

  it("handles month and year boundaries without local-time drift", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(periodRange("2026-02-10", "month")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("resolves the current date in Asia/Kolkata", () => {
    expect(todayInIndia(new Date("2026-09-17T20:00:00Z"))).toBe("2026-09-18");
  });

  it("normalizes weekly and monthly targets", () => {
    expect(normalizeTargetDate("2026-09-18", "Weekly")).toBe("2026-09-14");
    expect(normalizeTargetDate("2026-09-18", "Monthly")).toBe("2026-09-01");
  });

  it("waits until a goal period ends before marking it overdue", () => {
    const weekly = task({ dueDate: "2026-09-14", planType: "Weekly" });
    const monthly = task({ dueDate: "2026-09-01", planType: "Monthly" });
    expect(isTaskOverdue(weekly, "2026-09-20")).toBe(false);
    expect(isTaskOverdue(weekly, "2026-09-21")).toBe(true);
    expect(isTaskOverdue(monthly, "2026-09-30")).toBe(false);
    expect(isTaskOverdue(monthly, "2026-10-01")).toBe(true);
  });
});

describe("task ordering", () => {
  it("puts open overdue work first, then sorts by priority", () => {
    const sorted = sortTasks([
      task({ id: "done", status: "Done", priority: "High" }),
      task({ id: "low", priority: "Low" }),
      task({ id: "high", priority: "High" }),
      task({ id: "overdue", priority: "Medium", overdue: true, dueDate: "2026-09-17" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["overdue", "high", "low", "done"]);
  });
});
