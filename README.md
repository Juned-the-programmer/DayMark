# Daymark

Daymark is a private personal planner for tasks, daily habits, and journaling. The React app is hosted as a static GitHub Pages site, while a small Cloudflare Worker securely connects it to Notion.

## Features

- Today view with overdue tasks and active period goals
- Weekly goals for a complete Monday–Sunday week
- Monthly goals for a complete calendar month
- Dated tasks shown separately in Week and Month
- High, Medium, and Low task priorities
- Daily habits with streaks
- One autosaving journal entry per day
- Notion sync across devices
- Automatic overdue carry-over without changing the original due date

## Planning model

- **Today** contains dated daily tasks and a compact summary of current or overdue weekly/monthly goals.
- **Week** contains goals assigned to the visible Monday–Sunday week, followed by daily tasks scheduled inside it.
- **Month** contains goals assigned to the visible calendar month, followed by its daily scheduled tasks.
- An unfinished goal becomes carry-over only after its complete week or month ends. Its original target period is preserved.

## How it works

```text
Browser on GitHub Pages
        |
        | APP_ACCESS_KEY
        v
Cloudflare Worker
        |
        | NOTION_TOKEN
        v
Notion databases
```

GitHub Pages never receives the Notion token or database IDs. The Worker accepts requests only from the configured website origins and requires the personal access key.

## Requirements

- Node.js 22 or newer
- A GitHub account
- A Cloudflare account
- A Notion account and internal integration

## 1. Install the project

```sh
git clone https://github.com/juned-the-programmer/DayMark.git
cd DayMark
npm install
```

If the repository URL is different, replace it with your own.

## 2. Prepare Notion

### Create the integration

1. Open [Notion integrations](https://www.notion.so/profile/integrations).
2. Create a new internal integration.
3. Enable read, insert, and update content capabilities.
4. Copy the integration token and keep it private.

### Create and share the parent page

1. Create a blank Notion page, for example `Daymark`.
2. Open the page menu, select **Connections**, and connect the integration.
3. Copy the page ID from its URL. It is the 32-character value at the end of the URL, before any query parameters.

### Create the databases

Run:

```sh
npm run setup:notion
```

Enter the integration token and parent page ID when prompted. The script creates:

- Daymark Tasks
- Daymark Habits
- Daymark Habit Check-ins
- Daymark Journal

Save the four data-source IDs printed by the script. The token is used only for the request and is not written to disk.

Do not run this setup command again after the databases have been created, because it will create another set of databases.

### Upgrade an existing Daymark database

If Daymark was set up before period goals were added, run:

```sh
npm run upgrade:notion
```

Enter the integration token and the existing Tasks data-source ID. The command safely adds the `Plan Type` select property without recreating the database or changing existing task pages. It is safe to run again; existing tasks with no selected value continue to behave as Daily tasks.

## 3. Configure Cloudflare Workers

### Set the allowed origins

Open `worker/wrangler.jsonc` and set `ALLOWED_ORIGINS` to localhost and your GitHub Pages origin:

```json
"ALLOWED_ORIGINS": "http://localhost:5173,https://YOUR_USERNAME.github.io"
```

For this repository, the production value is:

```json
"ALLOWED_ORIGINS": "http://localhost:5173,https://juned-the-programmer.github.io"
```

Use only the origin. Do not include `/DayMark/` or another repository path.

### Generate the personal access key

Generate a random key:

```sh
openssl rand -base64 32
```

Store this value in a password manager. It is the password entered on Daymark's unlock screen. Do not commit it to GitHub or share it with anyone.

### Create the Worker

```sh
npx wrangler login
npm run worker:deploy
```

The first deployment creates the `daymark-api` Worker. It will not be ready until its secrets are added.

### Add the Worker secrets

Run each command and paste the requested value when prompted:

```sh
npx wrangler secret put NOTION_TOKEN --config worker/wrangler.jsonc
npx wrangler secret put TASKS_DATA_SOURCE_ID --config worker/wrangler.jsonc
npx wrangler secret put HABITS_DATA_SOURCE_ID --config worker/wrangler.jsonc
npx wrangler secret put CHECKINS_DATA_SOURCE_ID --config worker/wrangler.jsonc
npx wrangler secret put JOURNAL_DATA_SOURCE_ID --config worker/wrangler.jsonc
npx wrangler secret put APP_ACCESS_KEY --config worker/wrangler.jsonc
```

Deploy once more:

```sh
npm run worker:deploy
```

Save the Worker URL printed after deployment. It will look similar to:

```text
https://daymark-api.example.workers.dev
```

The same secrets can alternatively be managed in **Cloudflare Dashboard → Workers & Pages → daymark-api → Settings → Variables and Secrets**.

## 4. Test locally

Create `.env.local` from the example:

```sh
cp .env.example .env.local
```

Set the Worker URL in `.env.local`:

```env
VITE_API_URL=https://daymark-api.example.workers.dev
```

Start Daymark:

```sh
npm run dev
```

Open the localhost URL shown in the terminal and enter `APP_ACCESS_KEY`. Before publishing, verify that a task, habit check-in, and journal entry appear in Notion.

## 5. Deploy to GitHub Pages

Use a separate repository for Daymark. This does not affect an existing portfolio or other GitHub Pages sites.

1. Push this project to the repository's `main` branch.
2. Open **Repository Settings → Secrets and variables → Actions → Variables**.
3. Create a repository variable named `VITE_API_URL` containing the full Worker URL.
4. Open **Repository Settings → Pages**.
5. Under **Build and deployment**, select **GitHub Actions** as the source.
6. Open **Actions**, select **Deploy Daymark to GitHub Pages**, and run the workflow.

For the repository `juned-the-programmer/DayMark`, the site URL is:

```text
https://juned-the-programmer.github.io/DayMark/
```

The Vite configuration uses relative asset paths, so the app works from a GitHub project subpath.

## Updating the app

Push changes to `main`:

```sh
git add .
git commit -m "Describe the change"
git push
```

GitHub Actions tests, builds, and republishes the site automatically. Worker changes require a separate deployment:

```sh
npm run worker:deploy
```

When updating an existing installation to the period-goals version, use this order:

1. Run `npm run upgrade:notion`.
2. Deploy the Worker with `npm run worker:deploy`.
3. Push the frontend changes to GitHub.

## Useful commands

```sh
npm run dev           # Start the frontend locally
npm test              # Run tests
npm run build         # Create the production frontend build
npm run upgrade:notion # Add period goals to an existing Tasks database
npm run worker:check  # Type-check the Worker
npm run worker:dev    # Run the Worker locally
npm run worker:deploy # Deploy the Worker
```

For local Worker development, copy `worker/.dev.vars.example` to `worker/.dev.vars` and replace its placeholders. The `.dev.vars` file is ignored by Git.

## Troubleshooting

### The app says “Failed to fetch”

- Confirm `VITE_API_URL` contains the complete HTTPS Worker URL without quotes.
- Confirm the GitHub Actions repository variable is named exactly `VITE_API_URL`.
- Confirm `ALLOWED_ORIGINS` contains `https://YOUR_USERNAME.github.io`, without the repository path.
- Redeploy the Worker after changing `worker/wrangler.jsonc`.
- Rerun the GitHub Pages workflow after changing `VITE_API_URL`.
- Allow a few minutes for a new Worker or Pages deployment to become reachable.

### The app says the access key is incorrect

Run the following command to replace the Worker secret, then enter the same value in Daymark:

```sh
npx wrangler secret put APP_ACCESS_KEY --config worker/wrangler.jsonc
```

Use Daymark's **Lock** action to remove an old key saved in the browser.

### Notion requests fail

- Confirm the parent page and created databases are still shared with the integration.
- Confirm the Worker uses data-source IDs printed by `npm run setup:notion`, not browser URLs.
- Re-add any incorrect Worker secret and redeploy the Worker.
- If goal creation fails, run `npm run upgrade:notion` and confirm Tasks contains a `Plan Type` select property.

## Security notes

- Never put `NOTION_TOKEN`, `APP_ACCESS_KEY`, or database IDs in frontend environment variables.
- Never commit `.env`, `.env.local`, `.dev.vars`, or copied credentials.
- `VITE_API_URL` is public by design and is safe to include in the frontend build.
- Use a unique, high-entropy access key and store it only on trusted devices.
- Use Daymark's **Lock** action before handing a device to someone else.

## Current limits

- Habits are daily only.
- Tasks and goals do not recur automatically.
- Journal entries are plain text and limited to 10,000 characters.
- There are no reminders, tags, attachments, collaboration features, or offline synchronization.

## License

This project is intended for personal use. Add a license file before distributing or accepting contributions.
