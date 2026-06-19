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

All file paths are scoped to a single workspace root directory. Paths that attempt to escape it are rejected outright — `../` traversals, absolute paths outside the root, sibling-prefix paths, and **symlinks that resolve outside the root** all fail with an error returned to the model (no effect, no approval card). Scoping is enforced in the main process with `realpath` canonicalization, so a symlink planted inside the workspace cannot be used to escape it.

The workspace root defaults to `~/Documents/copilotkit-electron-workspace` and can be overridden before launch:

```
COPILOT_WORKSPACE_ROOT=/path/to/your/workspace pnpm --filter @copilotkit/electron-demo dev
```

Or add it to your `.env` file:

```
COPILOT_WORKSPACE_ROOT=/path/to/your/workspace
```

### Security model

- **Process isolation** — `contextIsolation: true`, `nodeIntegration: false`, a narrow typed `window.electron` preload surface, a scoped CSP, and the runtime bound to `127.0.0.1` only.
- **Path scoping is enforced in the main process** — every fs operation re-resolves the renderer-supplied path against the workspace root using `realpath`, so neither a buggy renderer nor a symlink planted inside the workspace can escape the root. File reads are size-capped (10 MiB) so a huge file can't exhaust main-process memory.
- **The approval card is the guard for side effects** — `fs_write` and `shell_run` only ever execute from a human **Approve** click. `shell_run` runs the command with **your OS privileges** and has no built-in allowlist, so review the exact command shown on the card before approving. (An optional command allow/deny-list is a follow-up.)
- **Trusted renderer** — the renderer runs bundled app code, not remote web content, so exposing the IPC to it is intentional under this threat model.

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

## MCP servers

The assistant can use tools from any MCP server alongside the built-in fs/shell tools. Two transport types are supported:

- **stdio** — the server is spawned as a child process of the Electron main process (e.g. `npx -y @modelcontextprotocol/server-filesystem ~/Documents`).
- **HTTP/SSE** — a remote server reachable by URL (e.g. a self-hosted or cloud MCP endpoint).

All tools advertised by every enabled server are merged into the agent's tool set and become available to the assistant in the same conversation.

### Security

MCP stdio servers are spawned as **child processes with your OS user privileges** by the Electron main process, using the `command` and `args` from your `mcp.config.json`. This is the same trust model as Claude Desktop — review every entry in your config before adding it, since a malicious server definition could execute arbitrary code on your machine.

### Config file

Server configuration follows the Claude Desktop `mcp_servers` style, stored in a file named `mcp.config.json`:

```json
{
  "servers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": {}
    },
    "my-remote-server": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

- **stdio server** — provide `command`, `args`, and an optional `env` map.
- **HTTP/SSE server** — provide only `url`.

**Where it is read from:**

1. `<Electron userData>/mcp.config.json` — your personal config; edit this to add or swap servers.
2. Bundled `mcp.config.example.json` (fallback) — used when no user config exists. This fallback is resolved from the source tree during development (`pnpm dev`), so the app works out of the box **in dev**. A packaged build does not copy it into the app bundle, so a packaged install needs a `mcp.config.json` in the Electron `userData` directory until packaging support is wired (a follow-up).

The bundled example runs `@modelcontextprotocol/server-everything` via `npx`, which exposes demo tools such as `echo` and `add`. To use the filesystem server instead, create a `mcp.config.json` in your `userData` directory:

```bash
# macOS example — adjust path for Windows/Linux
mkdir -p ~/Library/Application\ Support/copilotkit-electron
cp examples/v2/electron/mcp.config.example.json \
   ~/Library/Application\ Support/copilotkit-electron/mcp.config.json
```

Then edit the new file to replace `@modelcontextprotocol/server-everything` with `@modelcontextprotocol/server-filesystem` (plus the directory argument you want to expose).

### Settings → MCP panel

Open **Settings** in the app and navigate to the **MCP** tab. The panel lists every server defined in your config with a live status badge:

| Badge        | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| `connecting` | The main process is starting or contacting the server.   |
| `ready`      | The server handshake succeeded; its tools are active.    |
| `error`      | Connection failed; hover the badge for the error detail. |

Each row has an **enable / disable toggle**. Disabling a server disconnects it immediately and removes its tools from the agent's tool set for subsequent turns — no restart required. Re-enabling a server that previously connected successfully restores its tools immediately. A server that never connected or is in an error state will not automatically retry on toggle until live-reconnect is implemented (a follow-up).

### How tools are registered

The Electron main process hosts an **MCP Manager** that:

1. Reads `mcp.config.json` on boot and connects to each enabled server via `@ai-sdk/mcp`.
2. Passes the live `mcpClients` providers to the v2 `BuiltInAgent` as stable references so they are included in every agent run without re-initialising the connections.
3. Owns the full server lifecycle — connecting on app boot, tearing down cleanly on quit, and re-connecting when a server is toggled back on.

The enable toggle operates on the Manager: a disabled server contributes zero tools to the agent, but its config is preserved so it can be re-enabled later.

### Demo video

The MCP integration is covered by the e2e suite alongside the existing tests:

```bash
pnpm nx run @copilotkit/electron-demo:e2e
# or
pnpm --filter @copilotkit/electron-demo test:e2e
```

Two specs run:

- **Server-ready spec** — deterministic; verifies that `server-everything` reaches `ready` status. Requires network access on a cold `npx` cache so it can download the server package.
- **Tool-call spec** — key-gated (auto-skips without a provider key); drives a real `echo` tool call through the assistant and asserts the result appears in chat.

Artifacts land in `e2e/.artifacts/` (gitignored):

- `mcp-panel.png` — screenshot of the MCP settings panel showing the server status.
- `mcp-tool-call.png` — screenshot of the tool-call result rendered in chat.
- `.webm` screen-recording of the full run.

### Not yet wired (follow-ups)

- **Add / edit / remove server UI** — servers can only be added by editing `mcp.config.json` directly; an in-app editor is a follow-up.
- **Live reconnect on re-enable** — re-enabling a server that never connected or previously errored does not automatically retry; a live-reconnect mechanism is a follow-up.
- **Health polling / streamed server logs** — the status badge reflects the initial connection state; periodic health checks and a live log view for each server process are follow-ups.

## Later

This foundation is the base for further capabilities — a browser-extension bridge — documented as they land.
