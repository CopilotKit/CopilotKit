# Tickets End-to-End Backend Sandboxing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the tickets system so each ticket can optionally define a custom Node runtime handler and/or a custom Python agent, enabling full end-to-end reproduction of any CopilotKit issue.

**Architecture:** Convention-based file discovery across three independent layers. Each layer looks for ticket-specific files by convention and auto-mounts them. No cross-layer imports — the URL convention (`/api/tickets/<id>/copilot` for Node, `/tickets/<id>` for Python) is the only contract.

**Tech Stack:** Fastify (Node server), FastAPI (Python agent), CopilotKit runtime, dynamic imports, glob-based discovery

---

## File Layout Convention

```
app/client/src/tickets/tkt-869.tsx     ← frontend sandbox (already implemented)
app/server/tickets/tkt-869.ts          ← Node runtime handler (optional)
agent/tickets/tkt_869.py               ← Python agent (optional)
```

Each ticket only creates files in the layers it needs.

URL convention:
- Node endpoint: `/api/tickets/tkt-869/copilot`
- Python agent: `http://localhost:8000/tickets/tkt-869`

---

### Task 1: Create `app/server/tickets/` directory with an example ticket handler

**Files:**
- Create: `app/server/tickets/tkt-869.ts`

**Step 1: Create the example ticket server handler**

This file exports a `handler` — a CopilotKit runtime endpoint function identical to what `server.ts` creates for the default endpoint, but configured for this ticket's agents.

```ts
// app/server/tickets/tkt-869.ts
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const agentBaseUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8000";

const agent = new LangGraphHttpAgent({
  url: `${agentBaseUrl}/tickets/tkt-869`,
});

const runtime = new CopilotRuntime({
  agents: {
    my_agent: agent,
  },
});

export const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/tickets/tkt-869/copilot",
});
```

**Step 2: Commit**

```bash
git add app/server/tickets/tkt-869.ts
git commit -m "feat: add example ticket server handler for TKT-869"
```

---

### Task 2: Add ticket handler discovery and mounting to server.ts

**Files:**
- Modify: `app/server.ts`

**Step 1: Extract the Fastify-to-Web-Request bridge into a reusable function**

The existing `handleCopilotRequest` function in `server.ts` bridges Fastify to a CopilotKit handler. Generalize it so ticket handlers can reuse the same bridging logic.

Refactor: extract a `createBridgeHandler(runtimeHandler)` function that returns a Fastify route handler. The existing `/api/copilot` route should use it too.

```ts
// Add this above the existing handleCopilotRequest function, then replace it

function createBridgeHandler(
  runtimeHandler: (req: Request) => Promise<Response>
) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      const url = `http://${req.hostname}:3000${req.url}`;
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (val !== undefined) {
          if (Array.isArray(val)) {
            val.forEach((v) => headers.append(key, v));
          } else {
            headers.set(key, val);
          }
        }
      }

      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        init.body =
          typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }

      const webRequest = new Request(url, init);
      const response = (await runtimeHandler(webRequest)) as Response;

      reply.status(response.status);
      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }

      if (response.body) {
        const readable = Readable.fromWeb(response.body as any);
        readable.on("error", (err) => {
          console.error("[copilot] upstream stream error:", err.message);
          readable.destroy();
        });
        return reply.send(readable);
      }
      return reply.send(await response.text());
    } catch (err: any) {
      const code = err?.code ?? "";
      console.error(`[copilot] request failed (${code}):`, err.message);
      if (!reply.sent) {
        return reply.status(502).send({ error: "Agent connection failed" });
      }
    }
  };
}
```

**Step 2: Use createBridgeHandler for the default /api/copilot route**

Replace:
```ts
server.all("/api/copilot", handleCopilotRequest);
```

With:
```ts
server.all("/api/copilot", createBridgeHandler(runtimeHandler));
```

Delete the old `handleCopilotRequest` function.

**Step 3: Add ticket handler discovery and mounting**

Add this block after the default `/api/copilot` route, before `server.vite.ready()`:

```ts
import { resolve, basename } from "node:path";
import { Glob } from "bun";

// Discover and mount ticket-specific CopilotKit endpoints
const ticketGlob = new Glob("*.ts");
const ticketsDir = resolve(import.meta.dirname, "server/tickets");
for await (const file of ticketGlob.scan(ticketsDir)) {
  const ticketId = basename(file, ".ts");
  const mod = await import(`./server/tickets/${file}`);
  if (mod.handler) {
    const endpoint = `/api/tickets/${ticketId}/copilot`;
    server.all(endpoint, createBridgeHandler(mod.handler));
    console.log(`[tickets] mounted ${endpoint}`);
  }
}
```

Note: Since the app runs on Bun, we use `Bun.Glob` for scanning. If there's a compatibility issue, fall back to `node:fs` with `readdirSync`. Verify during implementation.

**Step 4: Run the dev server and verify**

Run: `cd app && bun run dev`

Expected: Console shows `[tickets] mounted /api/tickets/tkt-869/copilot`. The default `/api/copilot` still works.

**Step 5: Commit**

```bash
git add app/server.ts
git commit -m "feat: add ticket handler discovery and mounting to server.ts"
```

---

### Task 3: Create `agent/tickets/` directory with an example ticket agent

**Files:**
- Create: `agent/tickets/__init__.py` (empty, makes it a package)
- Create: `agent/tickets/tkt_869.py`

**Step 1: Create the example ticket agent**

This is a minimal FastAPI sub-app that could be anything — a different agent, different tools, different model. For the example, keep it simple:

```python
# agent/tickets/tkt_869.py
from fastapi import FastAPI
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

@tool
def example_tool(query: str):
    """An example tool for this ticket's reproduction."""
    return f"Result for: {query}"

agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=[example_tool],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt="You are a test agent for ticket TKT-869 reproduction.",
)

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="my_agent",
        description="TKT-869 reproduction agent",
        graph=agent,
        config={"recursion_limit": 100},
    ),
    "/",
)
```

**Step 2: Create the __init__.py**

```python
# agent/tickets/__init__.py
# (empty file — makes this directory a Python package)
```

**Step 3: Commit**

```bash
git add agent/tickets/__init__.py agent/tickets/tkt_869.py
git commit -m "feat: add example ticket Python agent for TKT-869"
```

---

### Task 4: Add ticket agent discovery and mounting to agent.py

**Files:**
- Modify: `agent/agent.py`

**Step 1: Add ticket discovery at the bottom, after the existing endpoint registrations but before the `if __name__` block**

```python
# --- Auto-discover and mount ticket-specific agents ---
import importlib
from pathlib import Path

tickets_dir = Path(__file__).parent / "tickets"
if tickets_dir.is_dir():
    for ticket_file in sorted(tickets_dir.glob("*.py")):
        if ticket_file.name.startswith("_"):
            continue
        module_name = ticket_file.stem  # e.g. "tkt_869"
        ticket_id = module_name.replace("_", "-")  # e.g. "tkt-869"
        try:
            mod = importlib.import_module(f"tickets.{module_name}")
            app.mount(f"/tickets/{ticket_id}", mod.app)
            print(f"[tickets] mounted /tickets/{ticket_id}")
        except Exception as e:
            print(f"[tickets] failed to mount {module_name}: {e}")
```

This goes right before:
```python
if __name__ == "__main__":
```

**Step 2: Run the agent and verify**

Run: `cd agent && uv run python agent.py`

Expected: Console shows `[tickets] mounted /tickets/tkt-869`. The default `/` and `/hitl` endpoints still work.

**Step 3: Commit**

```bash
git add agent/agent.py
git commit -m "feat: add ticket agent discovery and mounting to agent.py"
```

---

### Task 5: Verify full end-to-end flow

**Step 1: Start both services**

Run: `bun run dev` (from the project root, starts both agent and app)

**Step 2: Manual verification checklist**

1. Console shows `[tickets] mounted /tickets/tkt-869` from agent
2. Console shows `[tickets] mounted /api/tickets/tkt-869/copilot` from server
3. Default `/api/copilot` still works (existing demo pages function)
4. Navigate to a ticket page in the browser
5. If the example ticket's frontend uses the ticket-specific endpoint, verify the CopilotKit sidebar connects to the custom agent

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "feat: end-to-end ticket sandboxing - complete implementation"
```
