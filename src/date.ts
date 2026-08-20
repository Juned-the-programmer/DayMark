import type { Period, Priority, Task } from "./types";

export const TIME_ZONE = "Asia/Kolkata";

export function todayInIndia(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDate(value: string, amount: number, period: Period = "day"): string {
  const date = parseDate(value);
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCDate(date.getUTCDate() + amount * (period === "week" ? 7 : 1));
  return toISODate(date);
}

export function periodRange(value: string, period: Period): { start: string; end: string } {
  const date = parseDate(value);
  if (period === "day") return { start: value, end: value };
  if (period === "week") {
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    const start = toISODate(date);
    date.setUTCDate(date.getUTCDate() + 6);
    return { start, end: toISODate(date) };
  }
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
  return { start: toISODate(start), end: toISODate(end) };
}

export function formatLong(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parseDate(value));
}

export function formatShort(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parseDate(value));
}

export function periodLabel(value: string, period: Period): string {
  if (period === "day") return formatLong(value);
  const range = periodRange(value, period);
  if (period === "week") return `${formatShort(range.start)} – ${formatShort(range.end)}`;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(parseDate(value));
}

const priorityOrder: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "Open" ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title);
  });
}

export function groupTasks(tasks: Task[]): Array<[string, Task[]]> {
  const groups = new Map<string, Task[]>();
  for (const task of sortTasks(tasks)) {
    const key = task.overdue && task.status === "Open" ? "overdue" : task.dueDate;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "overdue") return -1;
    if (b === "overdue") return 1;
    return a.localeCompare(b);
  });
}
