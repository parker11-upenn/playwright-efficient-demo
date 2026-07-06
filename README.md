# playwright-efficient-demo

A standalone Playwright script that logs into the CHAS DataHub stage app and creates an incident report with randomized data. It's a plain Node script (no test runner, no LLM/MCP needed at runtime) — once set up, you can run it anytime with a single command.

## How it works

`standalone-runner.js` does the following, end to end:

1. **Session reuse** — if `auth-state.json` exists, it launches the browser already logged in (cookies loaded from that file). If not, it logs in fresh using `CHAS_USERNAME`/`CHAS_PASSWORD` from `.env`, waits for you to approve the Duo push, then saves the authenticated session to `auth-state.json` so future runs skip Duo entirely.
2. **Creates a draft incident** by clicking "Create Incident Report" on the Incidents page.
3. **Location Date & Time tab** — fills a random recent date/time, then picks one of three location types at random:
   - College Houses or Sansom Place (random house + room number)
   - Elsewhere on campus (random location specifics)
   - Off-campus (random location specifics)
4. **People tab** — adds a person via "None/Unknown" with a placeholder description. This avoids looking up real student/staff records for synthetic test data.
5. **Summary tab** — fills a random incident description.
6. **Review & Submit tab** — submits the incident and waits for the real success signal (redirect back to the incidents list) rather than a fixed timeout.

Every step waits on an actual confirmation from the app (a success toast or a URL change) instead of just sleeping — if something breaks, the script throws with a clear error and saves `error-screenshot.png` for debugging.

## Setup

1. Install dependencies:
   ```
   npm install
   npx playwright install chromium
   ```
2. Create a `.env` file (already gitignored) with your Penn credentials:
   ```
   CHAS_USERNAME=your_pennkey
   CHAS_PASSWORD=your_password
   ```
   Never commit this file.

## Running it

```
npm run create-incident
```
(equivalent to `node standalone-runner.js`)

- **First run**: a browser window opens, logs in with your `.env` credentials, and sends a Duo push — approve it on your phone. Once logged in, the session is saved to `auth-state.json`.
- **Subsequent runs**: reuse `auth-state.json` and skip login/Duo entirely, as long as the session is still valid.
- If the saved session has expired, the script automatically falls back to a fresh login (Duo push again) and re-saves it.

Each run creates and submits exactly one incident, logging its incident number and the randomized data used (location, description, etc.) to the console.

### Options

- `HEADLESS=true npm run create-incident` — run without a visible browser window (useful once you trust the flow; Duo approval still works the same way).

## Files

| File | Purpose |
|---|---|
| `standalone-runner.js` | The main script — everything above lives here. |
| `.env` | Your Penn credentials (gitignored, not committed). |
| `auth-state.json` | Saved logged-in session/cookies (gitignored, auto-generated). |
| `error-screenshot.png` | Auto-saved screenshot if a run fails (gitignored, auto-generated). |
| `probe.js`, `inspect_login.mjs`, `mcp-explorer.js` | One-off scripts used during development to explore the app's login flow and DOM structure. Not needed to run the main script. |

## Troubleshooting

- **Stuck on login / Duo issues**: delete `auth-state.json` and re-run — this forces a fresh login.
- **A step times out or a selector no longer matches**: the app's UI likely changed. Check `error-screenshot.png` and re-inspect the relevant tab in a browser to find the new field/button, then update the corresponding locator in `standalone-runner.js`.
- **Missing credentials error**: make sure `.env` exists in the project root with both `CHAS_USERNAME` and `CHAS_PASSWORD` set.

## Security notes

- `.env` and `auth-state.json` both contain sensitive data (password, session cookies) and are gitignored. Don't remove them from `.gitignore` or commit them.
- If you ever accidentally commit a secret, rotating the credential is the real fix — rewriting git history only helps after that.
