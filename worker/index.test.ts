import { describe, expect, it } from "vitest";
import { __test } from "./index";

const page = (id: string, properties: Record<string, unknown>) => ({
  id,
  created_time: "2026-09-18T00:00:00.000Z",
  last_edited_time: "2026-09-18T00:00:00.000Z",
  properties,
});

const title = (content: string) => ({ title: [{ plain_text: content }] });
const richText = (content: string) => ({ rich_text: [{ plain_text: content }] });

describe("worker domain behavior", () => {
  it("keeps the original date when marking carry-over work overdue", () => {
    const task = __test.mapTask(page("task", {
      Name: title("Yesterday's task"),
      "Due Date": { date: { start: "2026-09-17" } },
      Priority: { select: { name: "High" } },
      Status: { select: { name: "Open" } },
      "Completed At": { date: null },
    }), "2026-09-18");
    expect(task).toMatchObject({ dueDate: "2026-09-17", overdue: true });
  });

  it("calculates a streak ending yesterday when today is incomplete", () => {
    const habit = page("habit", { Name: title("Read"), Active: { checkbox: true } });
    const checkIns = ["2026-09-17", "2026-09-16", "2026-09-15"].map((date) =>
      page(date, { Name: title(`habit:${date}`), "Habit ID": richText("habit"), Date: { date: { start: date } } }),
    );
    expect(__test.mapHabit(habit, "2026-09-18", checkIns)).toMatchObject({ completed: false, streak: 3 });
  });

  it("accepts only configured browser origins", () => {
    expect(__test.corsHeaders("https://me.github.io", "https://me.github.io,http://localhost:5173")).not.toBeNull();
    expect(__test.corsHeaders("https://attacker.example", "https://me.github.io")).toBeNull();
  });
});
