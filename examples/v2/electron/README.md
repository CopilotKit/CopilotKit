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

## Later

This foundation is the base for further capabilities — local filesystem/shell tools, MCP servers, a browser-extension bridge — documented as they land.
