# QA: Browser Use — Mastra

Mastra-only, **real-LLM** demo. The agent drives a **real LOCAL headless
browser** (Playwright Chromium — no Browserbase / hosted-browser API key) via
the `browse_web` tool and summarizes the results back into the CopilotKit chat.

## Runtime requirement (read first)

- `playwright` is a package dependency, but the browser binary is not bundled.
  Install it once before running the demo:

  ```bash
  npx playwright install chromium
  ```

- The demo needs a real `OPENAI_API_KEY` (the agent runs a live LLM) and live
  network access (it fetches real pages).
- The demo's Docker image must run `npx playwright install chromium` (and the
  matching OS libraries) for the browse to work in a deployed container. If the
  binary is missing, `browse_web` returns a structured error and the agent
  relays it — the run does not crash, but no results render.

## Why there is no aimock replay / D6 fixture

Browser navigation is **non-deterministic**: the top Hacker News stories and
any live page's contents change on every request, so there is nothing stable
to record-and-replay under aimock. This cell is therefore surfaced as a
Mastra-only, real-LLM demo, not a D6 aimock cell. The e2e spec
(`tests/e2e/browser-use.spec.ts`) is a lightweight smoke test (page loads,
pills render, input enabled) and does NOT drive a real browse.

## Test Steps (manual / real-LLM)

- [ ] `npx playwright install chromium` (once)
- [ ] Navigate to `/demos/browser-use`
- [ ] Verify the chat surface renders with both suggestion pills:
      "Show me the top Hacker News stories" and "Summarize the CopilotKit homepage"
- [ ] Click "Show me the top Hacker News stories"
  - [ ] While browsing, a results card shows a "browsing…" loading state
  - [ ] After the browse, the card lists several Hacker News stories with
        titles (links) and point counts
  - [ ] The agent writes a short text summary mentioning a few of the stories
- [ ] Click "Summarize the CopilotKit homepage"
  - [ ] The card shows a single page-read result (title + source host) and a
        short text excerpt
  - [ ] The agent summarizes what the page is about in 2-3 sentences

## Expected Results

- Custom per-tool renderer (`useRenderTool` on `browse_web`) renders a
  `BrowseResultsCard` with a loading state, a results list, and — if the local
  browser could not launch — a clear error banner (`data-testid="browse-error"`).
- The agent never fabricates stories or page contents; it summarizes only what
  the tool returned.
