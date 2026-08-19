import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const NOTION_VERSION = "2026-03-11";
const prompt = createInterface({ input: stdin, output: stdout });
const token = process.env.NOTION_TOKEN || (await prompt.question("Notion integration token: "));
const dataSourceId = process.env.TASKS_DATA_SOURCE_ID || (await prompt.question("Tasks data source ID: "));
prompt.close();

if (!token.trim() || !/^[a-f\d-]{32,36}$/i.test(dataSourceId.trim())) {
  throw new Error("A Notion token and valid Tasks data source ID are required.");
}

const dataSource = await notion("GET");
const existing = dataSource.properties?.["Plan Type"];
if (existing) {
  if (existing.type !== "select") throw new Error('The existing "Plan Type" property must be a Select property.');
  stdout.write('The "Plan Type" property is already configured. No changes were made.\n');
  process.exit(0);
}

await notion("PATCH", {
  properties: {
    "Plan Type": {
      select: {
        options: [
          { name: "Daily", color: "blue" },
          { name: "Weekly", color: "yellow" },
          { name: "Monthly", color: "purple" },
        ],
      },
    },
  },
});
stdout.write('Added "Plan Type" to Daymark Tasks. Existing rows will continue to behave as Daily tasks.\n');

async function notion(method, body) {
  const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId.trim()}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || `Notion returned ${response.status}.`);
  return value;
}
