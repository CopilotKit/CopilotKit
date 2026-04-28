# QA: CLI Start — LangGraph (Python)

## Prerequisites

- Dashboard host accessible; the `cli-start` cell is an informational command cell (no `/demos/cli-start/` route)
- Local machine with Node.js 18+, npm 9+, and Python 3.11+ available; network access to the npm registry and GitHub
- Canonical starter for comparison: `showcase/starters/langgraph-python/` in the CopilotKit repo

## Test Steps

### 1. Dashboard Cell

- [ ] Open the LangGraph (Python) provider view on the dashboard; locate the "CLI Start Command" cell
- [ ] Verify the cell displays the exact command `npx copilotkit@latest init --framework langgraph-python`
- [ ] If a copy-to-clipboard button is present, click it; verify clipboard contents equal the command above (paste into a text editor to confirm)

### 2. Scaffold a Fresh Project

- [ ] In a fresh, empty directory, run `npx copilotkit@latest init --framework langgraph-python`
- [ ] Verify the CLI completes without errors and scaffolds a project tree that matches the canonical starter at `showcase/starters/langgraph-python/` (same top-level files: `package.json`, `next.config.ts`, `langgraph.json`, `showcase.json`, `tsconfig.json`, `postcss.config.mjs`, `Dockerfile`, `entrypoint.sh`, `src/`)
- [ ] Verify `package.json` references `@copilotkit/*` at version `2.0.0` or newer (matches `copilotkit_version` in the provider manifest)

### 3. Install + Boot

- [ ] Run `npm install` in the scaffolded directory; verify it completes with no error-level output
- [ ] Start the Next.js dev server per the scaffolded project's README / `package.json` `dev` script (typically `npm run dev`); verify it binds and logs a local URL (e.g. `http://localhost:3000`)
- [ ] Start the LangGraph backend per the scaffolded project's instructions (typically `langgraph dev` using `langgraph.json`); verify it binds without error
- [ ] Open the local URL in a browser; verify the starter demo renders (the "Sales Dashboard" surface per the manifest `starter.name`) and a basic chat round-trip works

### 4. Error Handling

- [ ] Re-run the CLI in a non-empty directory; verify it either refuses or prompts before overwriting (does not silently clobber)
- [ ] Verify the scaffolded project has no lockfile merge conflicts and no unresolved peer-dependency errors in `npm install` output

## Expected Results

- CLI command copies cleanly and runs without interactive blockers (aside from any documented prompts)
- Scaffolded tree matches the canonical starter shape
- `npm install` completes without error; dev server + LangGraph backend boot; starter demo is interactive
