import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const NOTION_VERSION = "2026-03-11";
const prompt = createInterface({ input: stdin, output: stdout });

const token = process.env.NOTION_TOKEN || (await prompt.question("Notion integration token: "));
const parentPageId = process.env.NOTION_PARENT_PAGE_ID || (await prompt.question("Parent Notion page ID: "));
prompt.close();

if (!token.trim() || !/^[a-f\d-]{32,36}$/i.test(parentPageId.trim())) {
  throw new Error("A Notion token and valid parent page ID are required.");
}

const schemas = [
  {
    key: "TASKS_DATA_SOURCE_ID",
    title: "Daymark Tasks",
    description: "Tasks and completion history for Daymark.",
    properties: {
      Name: { title: {} },
      "Due Date": { date: {} },
      Priority: { select: { options: [{ name: "High", color: "red" }, { name: "Medium", color: "yellow" }, { name: "Low", color: "gray" }] } },
      Status: { select: { options: [{ name: "Open", color: "blue" }, { name: "Done", color: "green" }] } },
      "Completed At": { date: {} },
    },
  },
  {
    key: "HABITS_DATA_SOURCE_ID",
    title: "Daymark Habits",
    description: "Active daily habits for Daymark.",
    properties: { Name: { title: {} }, Active: { checkbox: {} } },
  },
  {
    key: "CHECKINS_DATA_SOURCE_ID",
    title: "Daymark Habit Check-ins",
    description: "Daily habit completion history for Daymark.",
    properties: { Name: { title: {} }, "Habit ID": { rich_text: {} }, Date: { date: {} } },
  },
  {
    key: "JOURNAL_DATA_SOURCE_ID",
    title: "Daymark Journal",
    description: "One plain-text journal entry per day for Daymark.",
    properties: { Name: { title: {} }, Date: { date: {} }, Entry: { rich_text: {} } },
  },
];

const results = {};
for (const schema of schemas) {
  stdout.write(`Creating ${schema.title}… `);
  const database = await notion("/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId.trim() },
      title: [{ type: "text", text: { content: schema.title } }],
      description: [{ type: "text", text: { content: schema.description } }],
      is_inline: false,
      initial_data_source: { properties: schema.properties },
    }),
  });
  const fullDatabase = database.data_sources?.length ? database : await notion(`/databases/${database.id}`);
  const dataSourceId = fullDatabase.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`Notion created ${schema.title}, but its data source ID was not returned.`);
  results[schema.key] = dataSourceId;
  stdout.write("done\n");
}

stdout.write("\nAdd these values as Cloudflare Worker secrets:\n\n");
for (const [key, value] of Object.entries(results)) stdout.write(`${key}=${value}\n`);
stdout.write("\nThe Notion token was not written to disk.\n");

async function notion(path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `Notion returned ${response.status}.`);
  return body;
}
