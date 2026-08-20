import type { DashboardResponse, Habit, HabitInput, Period, Task, TaskInput } from "./types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new ApiError("Set VITE_API_URL before connecting.", 0);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? "The request could not be completed.", response.status);
  return body as T;
}

export const client = {
  dashboard: (key: string, date: string, period: Period) =>
    api<DashboardResponse>(`/v1/dashboard?date=${date}&period=${period}`, key),
  createTask: (key: string, input: TaskInput) =>
    api<Task>("/v1/tasks", key, { method: "POST", body: JSON.stringify(input) }),
  updateTask: (key: string, id: string, input: Partial<TaskInput & { status: "Open" | "Done" }>) =>
    api<Task>(`/v1/tasks/${id}`, key, { method: "PATCH", body: JSON.stringify(input) }),
  deleteTask: (key: string, id: string) =>
    api<{ ok: true }>(`/v1/tasks/${id}`, key, { method: "DELETE" }),
  createHabit: (key: string, input: HabitInput) =>
    api<Habit>("/v1/habits", key, { method: "POST", body: JSON.stringify(input) }),
  updateHabit: (key: string, id: string, input: Partial<HabitInput & { active: boolean }>) =>
    api<Habit>(`/v1/habits/${id}`, key, { method: "PATCH", body: JSON.stringify(input) }),
  deleteHabit: (key: string, id: string) =>
    api<{ ok: true }>(`/v1/habits/${id}`, key, { method: "DELETE" }),
  checkHabit: (key: string, id: string, date: string, completed: boolean) =>
    api<Habit>(`/v1/habits/${id}/check-ins/${date}`, key, {
      method: "PUT",
      body: JSON.stringify({ completed }),
    }),
  saveJournal: (key: string, date: string, text: string) =>
    api<{ id: string; date: string; text: string; lastSavedAt: string }>(`/v1/journal/${date}`, key, {
      method: "PUT",
      body: JSON.stringify({ text }),
    }),
};
