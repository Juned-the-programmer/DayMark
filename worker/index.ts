interface Env {
  NOTION_TOKEN: string;
  TASKS_DATA_SOURCE_ID: string;
  HABITS_DATA_SOURCE_ID: string;
  CHECKINS_DATA_SOURCE_ID: string;
  JOURNAL_DATA_SOURCE_ID: string;
  APP_ACCESS_KEY: string;
  ALLOWED_ORIGINS: string;
}

type Json = Record<string, unknown>;
type Period = "day" | "week" | "month";
type Priority = "High" | "Medium" | "Low";

interface NotionPage {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, any>;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: string,
  ) {
    super(message);
  }
}

const NOTION_VERSION = "2026-03-11";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-f\d-]{32,36}$/i;
const PRIORITIES = new Set<Priority>(["High", "Medium", "Low"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    if (request.method === "OPTIONS") {
      return cors ? new Response(null, { status: 204, headers: cors }) : json({ error: "Origin not allowed." }, 403);
    }
    if (origin && !cors) return json({ error: "Origin not allowed." }, 403);

    try {
      await authorize(request, env.APP_ACCESS_KEY);
      const response = await route(request, env);
      for (const [name, value] of Object.entries(cors ?? {})) response.headers.set(name, value);
      return response;
    } catch (reason) {
      const error = reason instanceof HttpError ? reason : new HttpError(500, "The request could not be completed.");
      const headers: Record<string, string> = { ...(cors ?? {}) };
      if (error.retryAfter) headers["Retry-After"] = error.retryAfter;
      return json({ error: error.message }, error.status, headers);
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");

  if (request.method === "GET" && path === "/v1/dashboard") {
    const date = validDate(url.searchParams.get("date"));
    const period = url.searchParams.get("period") as Period;
    if (!(["day", "week", "month"] as string[]).includes(period)) throw new HttpError(400, "Invalid planner period.");
    return json(await getDashboard(env, date, period));
  }
  if (request.method === "POST" && path === "/v1/tasks") return json(await createTask(env, await body(request)), 201);
  const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const id = validId(taskMatch[1]);
    if (request.method === "PATCH") return json(await updateTask(env, id, await body(request)));
    if (request.method === "DELETE") return json(await trashPage(env, id));
  }
  if (request.method === "POST" && path === "/v1/habits") return json(await createHabit(env, await body(request)), 201);
  const habitMatch = path.match(/^\/v1\/habits\/([^/]+)$/);
  if (habitMatch) {
    const id = validId(habitMatch[1]);
    if (request.method === "PATCH") return json(await updateHabit(env, id, await body(request)));
    if (request.method === "DELETE") return json(await trashPage(env, id));
  }
  const checkInMatch = path.match(/^\/v1\/habits\/([^/]+)\/check-ins\/(\d{4}-\d{2}-\d{2})$/);
  if (request.method === "PUT" && checkInMatch) {
    return json(await setCheckIn(env, validId(checkInMatch[1]), validDate(checkInMatch[2]), await body(request)));
  }
  const journalMatch = path.match(/^\/v1\/journal\/(\d{4}-\d{2}-\d{2})$/);
  if (request.method === "PUT" && journalMatch) {
    return json(await saveJournal(env, validDate(journalMatch[1]), await body(request)));
  }
  throw new HttpError(404, "Route not found.");
}

async function getDashboard(env: Env, date: string, period: Period) {
  const range = periodRange(date, period);
  const taskFilter = period === "day"
    ? {
        or: [
          { property: "Due Date", date: { equals: date } },
          { and: [{ property: "Status", select: { equals: "Open" } }, { property: "Due Date", date: { before: date } }] },
        ],
      }
    : {
        or: [
          { and: [{ property: "Due Date", date: { on_or_after: range.start } }, { property: "Due Date", date: { on_or_before: range.end } }] },
          { and: [{ property: "Status", select: { equals: "Open" } }, { property: "Due Date", date: { before: range.start } }] },
        ],
      };
  const [taskPages, habitPages] = await Promise.all([
    queryAll(env, env.TASKS_DATA_SOURCE_ID, { filter: taskFilter, sorts: [{ property: "Due Date", direction: "ascending" }] }),
    period === "day"
      ? queryAll(env, env.HABITS_DATA_SOURCE_ID, { filter: { property: "Active", checkbox: { equals: true } }, sorts: [{ timestamp: "created_time", direction: "ascending" }] })
      : Promise.resolve([]),
  ]);

  let habits: ReturnType<typeof mapHabit>[] = [];
  let journal = null;
  if (period === "day") {
    const streakStart = shiftDate(date, -400);
    const [checkIns, journalPages] = await Promise.all([
      queryAll(env, env.CHECKINS_DATA_SOURCE_ID, {
        filter: { and: [{ property: "Date", date: { on_or_after: streakStart } }, { property: "Date", date: { on_or_before: date } }] },
        sorts: [{ property: "Date", direction: "descending" }],
      }),
      queryAll(env, env.JOURNAL_DATA_SOURCE_ID, { filter: { property: "Date", date: { equals: date } }, page_size: 2 }),
    ]);
    habits = habitPages.map((page) => mapHabit(page, date, checkIns));
    journal = journalPages.length ? mapJournal(journalPages.sort((a, b) => b.last_edited_time.localeCompare(a.last_edited_time))[0]) : null;
  }

  return {
    date,
    period,
    range,
    tasks: taskPages.map((page) => mapTask(page, date)).sort(compareTasks),
    habits,
    journal,
    syncedAt: new Date().toISOString(),
  };
}

async function createTask(env: Env, input: Json) {
  const title = textField(input.title, "Task title", 200);
  const dueDate = validDate(input.dueDate);
  const priority = validPriority(input.priority);
  const page = await notion<NotionPage>(env, "/pages", "POST", {
    parent: { type: "data_source_id", data_source_id: env.TASKS_DATA_SOURCE_ID },
    properties: taskProperties({ title, dueDate, priority, status: "Open" }),
  });
  return mapTask(page, indiaToday());
}

async function updateTask(env: Env, id: string, input: Json) {
  const properties: Json = {};
  if (input.title !== undefined) properties.Name = titleProperty(textField(input.title, "Task title", 200));
  if (input.dueDate !== undefined) properties["Due Date"] = { date: { start: validDate(input.dueDate) } };
  if (input.priority !== undefined) properties.Priority = { select: { name: validPriority(input.priority) } };
  if (input.status !== undefined) {
    if (input.status !== "Open" && input.status !== "Done") throw new HttpError(400, "Invalid task status.");
    properties.Status = { select: { name: input.status } };
    properties["Completed At"] = { date: input.status === "Done" ? { start: new Date().toISOString() } : null };
  }
  if (!Object.keys(properties).length) throw new HttpError(400, "No task changes supplied.");
  const page = await notion<NotionPage>(env, `/pages/${id}`, "PATCH", { properties });
  return mapTask(page, indiaToday());
}

async function createHabit(env: Env, input: Json) {
  const name = textField(input.name, "Habit name", 100);
  const page = await notion<NotionPage>(env, "/pages", "POST", {
    parent: { type: "data_source_id", data_source_id: env.HABITS_DATA_SOURCE_ID },
    properties: { Name: titleProperty(name), Active: { checkbox: true } },
  });
  return mapHabit(page, indiaToday(), []);
}

async function updateHabit(env: Env, id: string, input: Json) {
  const properties: Json = {};
  if (input.name !== undefined) properties.Name = titleProperty(textField(input.name, "Habit name", 100));
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new HttpError(400, "Active must be true or false.");
    properties.Active = { checkbox: input.active };
  }
  if (!Object.keys(properties).length) throw new HttpError(400, "No habit changes supplied.");
  const page = await notion<NotionPage>(env, `/pages/${id}`, "PATCH", { properties });
  return mapHabit(page, indiaToday(), []);
}

async function setCheckIn(env: Env, habitId: string, date: string, input: Json) {
  if (typeof input.completed !== "boolean") throw new HttpError(400, "Completed must be true or false.");
  const title = `${habitId}:${date}`;
  const existing = await queryAll(env, env.CHECKINS_DATA_SOURCE_ID, {
    filter: { property: "Name", title: { equals: title } },
    page_size: 10,
  });
  if (input.completed && !existing.length) {
    await notion(env, "/pages", "POST", {
      parent: { type: "data_source_id", data_source_id: env.CHECKINS_DATA_SOURCE_ID },
      properties: {
        Name: titleProperty(title),
        "Habit ID": richTextProperty(habitId),
        Date: { date: { start: date } },
      },
    });
  }
  if (!input.completed) await Promise.all(existing.map((page) => notion(env, `/pages/${page.id}`, "PATCH", { in_trash: true })));

  const [habitPage, recent] = await Promise.all([
    notion<NotionPage>(env, `/pages/${habitId}`),
    queryAll(env, env.CHECKINS_DATA_SOURCE_ID, {
      filter: {
        and: [
          { property: "Habit ID", rich_text: { equals: habitId } },
          { property: "Date", date: { on_or_after: shiftDate(date, -400) } },
          { property: "Date", date: { on_or_before: date } },
        ],
      },
      sorts: [{ property: "Date", direction: "descending" }],
    }),
  ]);
  const adjusted = input.completed && !existing.length
    ? [...recent, fakeCheckIn(habitId, date)]
    : recent.filter((page) => propertyText(page, "Name") !== title);
  return mapHabit(habitPage, date, adjusted);
}

async function saveJournal(env: Env, date: string, input: Json) {
  if (typeof input.text !== "string" || input.text.length > 10_000) throw new HttpError(400, "Journal entry must be 10,000 characters or less.");
  const existing = await queryAll(env, env.JOURNAL_DATA_SOURCE_ID, { filter: { property: "Date", date: { equals: date } }, page_size: 2 });
  const properties = { Name: titleProperty(date), Date: { date: { start: date } }, Entry: richTextProperty(input.text) };
  const page = existing.length
    ? await notion<NotionPage>(env, `/pages/${existing.sort((a, b) => b.last_edited_time.localeCompare(a.last_edited_time))[0].id}`, "PATCH", { properties })
    : await notion<NotionPage>(env, "/pages", "POST", { parent: { type: "data_source_id", data_source_id: env.JOURNAL_DATA_SOURCE_ID }, properties });
  return mapJournal(page);
}

async function trashPage(env: Env, id: string) {
  await notion(env, `/pages/${id}`, "PATCH", { in_trash: true });
  return { ok: true };
}

async function queryAll(env: Env, dataSourceId: string, query: Json): Promise<NotionPage[]> {
  const results: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion<{ results: NotionPage[]; has_more: boolean; next_cursor: string | null }>(
      env,
      `/data_sources/${dataSourceId}/query`,
      "POST",
      { page_size: 100, ...query, ...(cursor ? { start_cursor: cursor } : {}) },
    );
    results.push(...page.results);
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function notion<T = unknown>(env: Env, path: string, method = "GET", bodyValue?: unknown): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: bodyValue === undefined ? undefined : JSON.stringify(bodyValue),
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After") ?? undefined;
    const message = response.status === 429 ? "Notion is busy. Please retry shortly." : "Notion could not complete this request.";
    throw new HttpError(response.status >= 500 ? 502 : response.status, message, retryAfter);
  }
  return response.json() as Promise<T>;
}

function mapTask(page: NotionPage, referenceDate: string) {
  const dueDate = propertyDate(page, "Due Date");
  const status = propertySelect(page, "Status") === "Done" ? "Done" : "Open";
  return {
    id: page.id,
    title: propertyText(page, "Name"),
    dueDate,
    priority: validPriority(propertySelect(page, "Priority") || "Medium"),
    status,
    completedAt: propertyDate(page, "Completed At") || null,
    overdue: status === "Open" && dueDate < referenceDate,
  };
}

function mapHabit(page: NotionPage, date: string, checkIns: NotionPage[]) {
  const dates = new Set(
    checkIns.filter((item) => propertyText(item, "Habit ID") === page.id).map((item) => propertyDate(item, "Date")),
  );
  const completed = dates.has(date);
  let cursor = completed ? date : shiftDate(date, -1);
  let streak = 0;
  while (dates.has(cursor) && streak < 400) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return { id: page.id, name: propertyText(page, "Name"), active: page.properties.Active?.checkbox !== false, completed, streak };
}

function mapJournal(page: NotionPage) {
  return { id: page.id, date: propertyDate(page, "Date"), text: propertyText(page, "Entry"), lastSavedAt: page.last_edited_time };
}

function fakeCheckIn(habitId: string, date: string): NotionPage {
  return {
    id: "pending",
    created_time: new Date().toISOString(),
    last_edited_time: new Date().toISOString(),
    properties: {
      Name: titleProperty(`${habitId}:${date}`),
      "Habit ID": richTextProperty(habitId),
      Date: { date: { start: date } },
    },
  };
}

function propertyText(page: NotionPage, name: string): string {
  const property = page.properties[name];
  const values = property?.title ?? property?.rich_text ?? [];
  return values.map((item: { plain_text?: string; text?: { content?: string } }) => item.plain_text ?? item.text?.content ?? "").join("");
}

function propertyDate(page: NotionPage, name: string): string {
  return page.properties[name]?.date?.start ?? "";
}

function propertySelect(page: NotionPage, name: string): string {
  return page.properties[name]?.select?.name ?? "";
}

function titleProperty(value: string) {
  return { title: [{ type: "text", text: { content: value } }] };
}

function richTextProperty(value: string) {
  const chunks = value.match(/[\s\S]{1,1900}/g) ?? [];
  return { rich_text: chunks.map((content) => ({ type: "text", text: { content } })) };
}

function taskProperties(input: { title: string; dueDate: string; priority: Priority; status: "Open" | "Done" }) {
  return {
    Name: titleProperty(input.title),
    "Due Date": { date: { start: input.dueDate } },
    Priority: { select: { name: input.priority } },
    Status: { select: { name: input.status } },
    "Completed At": { date: null },
  };
}

function compareTasks(a: ReturnType<typeof mapTask>, b: ReturnType<typeof mapTask>) {
  const priority = { High: 0, Medium: 1, Low: 2 };
  if (a.status !== b.status) return a.status === "Open" ? -1 : 1;
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  return priority[a.priority] - priority[b.priority] || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title);
}

function periodRange(value: string, period: Period) {
  if (period === "day") return { start: value, end: value };
  const date = parseDate(value);
  if (period === "week") {
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
    const start = isoDate(date);
    date.setUTCDate(date.getUTCDate() + 6);
    return { start, end: isoDate(date) };
  }
  return {
    start: isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12))),
    end: isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12))),
  };
}

function shiftDate(value: string, days: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value) || isoDate(parseDate(value)) !== value) throw new HttpError(400, "Invalid date.");
  return value;
}

function validId(value: string): string {
  if (!ID.test(value)) throw new HttpError(400, "Invalid record ID.");
  return value;
}

function validPriority(value: unknown): Priority {
  if (typeof value !== "string" || !PRIORITIES.has(value as Priority)) throw new HttpError(400, "Invalid priority.");
  return value as Priority;
}

function textField(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpError(400, `${label} is required and must be ${max} characters or less.`);
  return value.trim();
}

async function body(request: Request): Promise<Json> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 25_000) throw new HttpError(413, "Request is too large.");
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Json;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

async function authorize(request: Request, expected: string) {
  if (!expected || expected.length < 32) throw new HttpError(503, "API access is not configured.");
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const [left, right] = await Promise.all([sha256(supplied), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  if (!supplied || difference !== 0) throw new HttpError(401, "That access key is not valid.");
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function corsHeaders(origin: string | null, configured: string): Record<string, string> | null {
  if (!origin) return {};
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

export const __test = { periodRange, shiftDate, mapTask, mapHabit, compareTasks, validDate, corsHeaders };
