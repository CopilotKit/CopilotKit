"use client";

/**
 * Beautiful Chat — the flagship CopilotKit showcase cell, ported 1:1 from the
 * langgraph-python reference (`integrations/langgraph-python/src/app/demos/
 * beautiful-chat/`) and re-wired for the hermes AG-UI transport.
 *
 * The whole `components/`, `declarative-generative-ui/`, `hooks/`, and `lib/`
 * subtree is byte-identical to langgraph-python — it uses only v2 CopilotKit
 * hooks (`useComponent`, `useFrontendTool`, `useHumanInTheLoop`,
 * `useDefaultRenderTool`, `useAgent`) plus the `@copilotkit/a2ui-renderer`
 * catalog, which are transport-agnostic. Only THIS page and the dedicated
 * route diverge from langgraph.
 *
 * Runtime: this cell uses its own dedicated endpoint
 * (`/api/copilotkit-beautiful-chat`) so it can enable `openGenerativeUI`,
 * `a2ui` with `injectA2UITool: true`, and `mcpApps` simultaneously — the same
 * combined-runtime shape the canonical starter uses — without bleeding those
 * global flags into the other hermes cells on `/api/copilotkit`. It proxies to
 * the hermes AG-UI adapter via `HttpAgent` (see the route).
 *
 * Shared `todos` state — hermes divergence. langgraph-python's `beautiful_chat`
 * graph declares `todos` on its AgentState and mutates it via the backend
 * `manage_todos` tool (+ StateStreamingMiddleware). Hermes has no first-class
 * shared-state store, so — exactly like the green `gen-ui-agent` and
 * `shared-state-read-write` cells — the frontend DECLARES the state-writer
 * tools to the hermes adapter via `<CopilotKit properties={{ stateWriterTools }}>`
 * (forwarded verbatim into `RunAgentInput.forwarded_props`). The adapter
 * registers a server-side handler that merges each `manage_todos` call into
 * run-scoped state key `todos` and emits a `StateSnapshotEvent`, which
 * `useAgent({ agentId: "beautiful-chat" })` (in ExampleCanvas) renders.
 *
 * KNOWN DIVERGENCE (accepted): langgraph's StateStreamingMiddleware streams the
 * `todos` array token-by-token as `manage_todos` args arrive, so the App-pane
 * TodoList grows live during the tool call. The hermes adapter emits ONE
 * snapshot after the tool call returns (snapshot-after-tool), so todos appear
 * atomically rather than growing per-token. End state is identical.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

import { ThemeProvider } from "./hooks/use-theme";
import { demonstrationCatalog } from "./declarative-generative-ui/renderers";
import { HomePage } from "./home-page";

// State-writer declaration for the hermes adapter. `manage_todos({todos})`
// -> stateKey `todos` (replace, last-write-wins): each call carries the FULL
// todo list, the adapter merges it into run-scoped state and emits one
// StateSnapshotEvent that `useAgent` renders in the App pane. `get_todos` is a
// read-only companion (no stateKey write) so the model can inspect current
// todos. Mirrors langgraph's `manage_todos` / `get_todos` tools + the
// StateStreamingMiddleware(state_key="todos", tool="manage_todos",
// tool_argument="todos") binding.
const STATE_WRITER_TOOLS = [
  {
    name: "manage_todos",
    stateKey: "todos",
    arg: "todos",
    mode: "replace",
    description:
      "Manage the current todos. Pass the FULL updated list of todos as " +
      "`todos`. Each todo is { id, title, description, emoji, status } where " +
      "status is 'pending' or 'completed'.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The full updated list of todos.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              emoji: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "completed"],
              },
            },
            required: ["title", "description", "emoji", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
];

export default function BeautifulChatPage() {
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl="/api/copilotkit-beautiful-chat"
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
        properties={{ stateWriterTools: STATE_WRITER_TOOLS }}
      >
        <HomePage />
      </CopilotKit>
    </ThemeProvider>
  );
}
