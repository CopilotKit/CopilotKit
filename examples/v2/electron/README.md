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

## Later

This foundation is the base for further capabilities — local filesystem/shell tools, MCP servers, a browser-extension bridge — documented as they land.
