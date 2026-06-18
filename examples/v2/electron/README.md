# CopilotKit Electron Starter

A local-first desktop AI assistant built with CopilotKit + Electron. The Electron main process hosts the CopilotKit v2 runtime on a local HTTP server, and the React renderer is a standard `@copilotkit/react-core` client that talks to it — no external server required.

## Run (dev)

1. Build the workspace packages this app depends on (from the repo root):

   ```bash
   pnpm nx run-many -t build -p @copilotkit/runtime @copilotkit/react-core @copilotkit/core @copilotkit/shared
   ```

2. Provide a provider key: copy `.env.example` to `.env` and fill in `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`).

3. Launch:

   ```bash
   pnpm --filter @copilotkit/electron-demo dev
   ```

## Architecture

- `src/main` — Electron main process; boots the CopilotKit runtime HTTP server on an ephemeral `127.0.0.1` port and exposes its URL to the renderer over IPC.
- `src/preload` — `contextBridge` `window.electron` API (the only renderer→main surface).
- `src/renderer` — React app; a standard `@copilotkit/react-core/v2` client (`CopilotKitProvider` + `CopilotSidebar`) pointed at the runtime URL.

## End-to-end tests + video

Run the Playwright/Electron e2e suite with either command:

```bash
pnpm --filter @copilotkit/electron-demo test:e2e
# or via Nx
pnpm nx run @copilotkit/electron-demo:e2e
```

**What runs:**

- **Shell-render test** — always runs; requires no provider key. Verifies that the Electron window opens and the renderer mounts without errors.
- **Chat round-trip test** — auto-skips unless at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` is set in the environment. When a key is present it sends a real message and asserts a non-empty reply.

**Artifacts:** `.webm` screen-recording videos and `.png` failure stills are written to `e2e/.artifacts/`. That directory is gitignored and is never committed.

**CI note:** Linux CI must wrap the command with `xvfb-run -a` because Electron requires a display server (e.g. `xvfb-run -a pnpm --filter @copilotkit/electron-demo test:e2e`). macOS local runs need no wrapper.

## Local fs + shell tools (HITL)

The assistant exposes two tiers of file-system and shell tools, distinguished by whether they require human approval.

**Read-only tier — executes immediately:** `fs_list`, `fs_read`, and `fs_search` are handled server-side in the Electron main process with no user prompt. They are side-effect-free, so the model can invoke them freely while reasoning.

**Side-effecting tier — requires human approval:** `fs_write` and `shell_run` pop a **human approval card** in the chat UI before any effect is applied. The user can:

- **Approve** — the main process performs the operation (writes the file, runs the shell command) and streams the result back to the model.
- **Deny** — the operation is cancelled with no effect; the model receives a cancellation notice.

### Workspace root

All file paths are scoped to a single workspace root directory. Paths that attempt to escape it are rejected outright — `../` traversals, absolute paths outside the root, and sibling-prefix paths all fail with an error returned to the model (no effect, no approval card).

The workspace root defaults to `~/Documents/copilotkit-electron-workspace` and can be overridden before launch:

```
COPILOT_WORKSPACE_ROOT=/path/to/your/workspace pnpm --filter @copilotkit/electron-demo dev
```

Or add it to your `.env` file:

```
COPILOT_WORKSPACE_ROOT=/path/to/your/workspace
```

### Try it

Once the app is running, paste a prompt like the following into the chat:

> "Create a file called `hello.txt` inside my workspace with the contents: Hello from CopilotKit!"

The assistant will call `fs_write`. An approval card appears in the chat UI — click **Approve** and the file is written to your workspace root. Click **Deny** and nothing changes.

### Demo video

The HITL flow is covered by the e2e suite:

```bash
pnpm nx run @copilotkit/electron-demo:e2e
# or
pnpm --filter @copilotkit/electron-demo test:e2e
```

The chat and tool interaction tests require a provider key and auto-skip when none is present (same behaviour as the existing chat round-trip test). When a key is set, the suite drives the full approve/deny flow and records it.

Artifacts land in `e2e/.artifacts/` (gitignored):

- `.webm` screen-recording of the full run
- `.png` stills — including `hitl-prompt.png` (the approval card rendered in the UI) and `hitl-result.png` (the confirmed result shown in chat)

### Not yet wired (follow-ups)

- **Live incremental shell-output streaming** — `shell_run` currently waits for the process to exit and returns the complete output in one shot; streaming stdout/stderr line-by-line to the model while the process runs is a follow-up.
- **Runtime workspace folder-picker** — the workspace root is fixed at launch via the env var or the default path; a UI control to switch it without restarting the app is a follow-up.

## Later

This foundation is the base for further capabilities — MCP servers, a browser-extension bridge — documented as they land.
