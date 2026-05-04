# CopilotKit · Electron Starter

Minimal Electron + CopilotKit integration. The renderer runs the standard
React `<CopilotKit>` provider; the main process embeds the CopilotRuntime
on a localhost port using `node:http`. No external server required.

## Architecture

```
┌──────────────────────────── Electron app ───────────────────────────┐
│                                                                      │
│  Main process (Node.js)              Renderer process (Chromium)     │
│  ┌────────────────────────┐          ┌──────────────────────────┐    │
│  │ http.createServer      │ ◄──SSE──►│ <CopilotKit>             │    │
│  │  └─ createCopilotNode- │  fetch   │   <CopilotChat />        │    │
│  │      Listener({...})   │          │ </CopilotKit>            │    │
│  │                        │          │                          │    │
│  │ Agent: EchoAgent       │          │ runtimeUrl from preload  │    │
│  └────────────────────────┘          └──────────────────────────┘    │
│           ▲                                    ▲                     │
│           └──── ipcMain.handle ◄── contextBridge.exposeInMainWorld ──┘
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

The runtime listens on `127.0.0.1` with an OS-assigned port. On window
creation the main process publishes the resolved URL via IPC; the
preload script forwards it to the renderer through `contextBridge`.

## Run

```bash
pnpm install   # or npm install
pnpm dev       # launches Vite dev server + Electron
```

Build a production bundle:

```bash
pnpm build
pnpm start
```

## Swap in a real agent

The default `EchoAgent` (in `src/main/runtime-server.ts`) just echoes the
last user message — keeps the example dependency-free. Replace it with
any agent that implements `AbstractAgent`:

```ts
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    default: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
      graphId: "sample_agent",
    }),
  },
  runner: new InMemoryAgentRunner(),
});
```

The same pattern works for any backend agent (CrewAI, Mastra,
ms-agent-framework, custom). See `examples/integrations/*` for the
non-Electron equivalents.

## Notes on Electron specifics

- **CSP** — `index.html` allows `connect-src http://127.0.0.1:*` so the
  renderer can reach the embedded runtime. Tighten if you bind to a
  fixed port.
- **`sandbox: false`** — required for the preload script to use `ipcRenderer`.
  `contextIsolation` and `nodeIntegration: false` remain enabled, which
  is the secure default.
- **Port `0`** — letting the kernel pick a free port avoids conflicts
  when several CopilotKit-backed apps run side by side.
- **No browser blockers** — CopilotKit's frontend uses `fetch` +
  `ReadableStream` (not Node's `eventsource` package) for SSE, so it
  works inside Chromium without polyfills.

## What is *not* covered

- Production packaging (`electron-builder` / `electron-forge`) — add as
  needed.
- Persisting threads — swap `InMemoryAgentRunner` for the SQLite runner
  (`@copilotkit/sqlite-runner`) and store the database under
  `app.getPath("userData")`.
- Auto-updates, code signing, multi-window orchestration.
