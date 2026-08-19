export type Period = "day" | "week" | "month";
export type Priority = "High" | "Medium" | "Low";
export type TaskStatus = "Open" | "Done";
export type PlanType = "Daily" | "Weekly" | "Monthly";

export interface Task {
  id: string;
  title: string;
  dueDate: string;
  planType: PlanType;
  priority: Priority;
  status: TaskStatus;
  completedAt: string | null;
  overdue: boolean;
}

export interface Habit {
  id: string;
  name: string;
  active: boolean;
  completed: boolean;
  streak: number;
}

export interface JournalEntry {
  id: string | null;
  date: string;
  text: string;
  lastSavedAt: string | null;
}

export interface DashboardResponse {
  date: string;
  period: Period;
  range: { start: string; end: string };
  tasks: Task[];
  habits: Habit[];
  journal: JournalEntry | null;
  syncedAt: string;
}

export interface TaskInput {
  title: string;
  dueDate: string;
  priority: Priority;
  planType: PlanType;
}

export interface HabitInput {
  name: string;
}
