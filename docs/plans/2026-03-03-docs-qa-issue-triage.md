# Docs QA Issue Triage — 2026-03-03

Categorized list of issues reported from QA testing documentation examples, grouped by root cause.

---

## Decisions

| Category | Decision |
|---|---|
| Cat 1: `CopilotKit` not in V2 | **Update all docs to V1 path** — change imports to `@copilotkit/react-core` (no `/v2`) |
| Cat 2: V1-only hooks on `/v2` | **Update docs to use V2 equivalents:** `useCopilotReadable` → `useAgentContext`, `useDefaultTool` → `useDefaultRenderTool`, `useLangGraphInterrupt` → `useInterrupt`. Check reference docs for correct usage. |
| Cat 3: API shape mismatches | **Fix doc snippets** — use `const { agent } = useAgent(); agent.<property>` pattern throughout |
| Cat 4: CLI missing frameworks | Document for team to pick up |
| Cat 5: Runtime/config issues | **Just document** — leave for team to investigate |
| Cat 6: Missing dependencies | Fix in docs |

---

## Category 1: `CopilotKit` component not exported from V2

**Root cause:** V2 exports `CopilotKitProvider` (not `CopilotKit`). Docs that tell users to `import { CopilotKit } from "@copilotkit/react-core/v2"` fail. The V1 path (`@copilotkit/react-core`) does export `CopilotKit`.

**Fix:** Update all affected docs to import from `@copilotkit/react-core` (remove `/v2` suffix).

| Integration | Page | Error |
|---|---|---|
| Built-in Agent | Quickstart (Manual setup) | `"@copilotkit/react-core/v2"` does not export `CopilotKit` — "Element type is invalid: expected a string or class/function but got undefined" |
| LangGraph | Quickstart (FastAPI) | `"@copilotkit/react-core/v2"` has no exported member `CopilotKit` (layout.tsx) |
| LangGraph | Quickstart (LangSmith) | Same as above |
| Mastra | Quickstart (Existing Agent) | Same — resolved by removing `/v2` from import |
| Deep Agents | FastAPI and LangSmith guides | Same — `CopilotKit` not in `/v2` (layout.tsx) |
| MS Agent Framework (.NET) | Using an existing agent | `"@copilotkit/react-core/v2"` has no exported member `CopilotKit` (layout.tsx) |
| AWS Strands | Quickstart (Existing Agent) | Same — resolved by removing `/v2` from import |

---

## Category 2: V1-only hooks imported from `/v2` path

**Root cause:** Several hooks exist only in V1 (`@copilotkit/react-core`) and were never ported to V2. Docs reference them with the `/v2` import path.

**Fix:** Update docs to use V2 equivalents: `useCopilotReadable` → `useAgentContext`, `useDefaultTool` → `useDefaultRenderTool`, `useLangGraphInterrupt` → `useInterrupt`. Check reference docs for correct signatures.

| Hook | V1 export? | V2 export? | V2 equivalent | Affected pages |
|---|---|---|---|---|
| `useCopilotReadable` | Yes | **No** | `useAgentContext` | Mastra: App Control > Readables; Built-in Agent tutorials; MS Agent Framework (.NET): Readables; MS Agent Framework (Python): Readables |
| `useDefaultTool` | Yes | **No** | `useDefaultRenderTool` | Deep Agents: FastAPI/LangSmith (page.tsx) |
| `useLangGraphInterrupt` | Yes (wraps V2 `useInterrupt`) | **No** | `useInterrupt` | LangGraph: Interrupts (js and py); App Control > Interrupt-based (js and py) |
| `useComponent` | No | **Yes** | — | ADK: Generative UI > Display-only; Agno: Generative UI > Display-only; MS Agent Framework (Python): Display-only (import path or build issue) |

---

## Category 3: V2 API shape mismatches in doc examples

**Root cause:** Doc code snippets use APIs that don't match the actual V2 signatures.

**Fix:** Update doc snippets to use `const { agent } = useAgent(); agent.<property>` pattern. Fix undefined schemas, wrong argument counts, and type mismatches.

### 3a. `useAgent` returns `{ agent }`, not `{ agentState }`

`useAgent()` returns `{ agent: AbstractAgent }`. The `AbstractAgent` class (from `@ag-ui/client`) has a `.state` property, not a top-level `agentState` field.

| Integration | Page | Error |
|---|---|---|
| LlamaIndex | Shared State > Reading agent state | `Property agentState does not exist on type { agent: AbstractAgent }` |
| LlamaIndex | Shared State > Writing agent state | Same |
| LlamaIndex | Workflow execution / Predictive state | Same + binding elements `agentState, status` implicitly have `any` type |
| MS Agent Framework (Python) | Shared State > Reading | Same — `agentState` not on `{ agent: AbstractAgent }` |
| MS Agent Framework (Python) | Shared State > Writing | Same |

### 3b. `useComponent` — `weatherSchema` undefined in example

| Integration | Page | Error |
|---|---|---|
| LlamaIndex | Generative UI > Display-only | `Cannot find name 'weatherSchema'` — the example references an undefined schema variable |
| Agno | Generative UI > Display-only | `useComponent` doesn't exist error (may be import path issue) |
| ADK | Generative UI > Display-only | `useComponent` doesn't exist in target module — same pattern |

### 3c. Tool/hook argument count mismatches

| Integration | Page | Error |
|---|---|---|
| LlamaIndex | Tool Rendering | `Expected 0 arguments, but got 1` — hook call passes arg that signature doesn't accept |
| LlamaIndex | State Rendering | `Expected 0 type arguments, but got 1` — generic type params not expected |
| MS Agent Framework (.NET) | Tool Rendering | Tool calling not rendered in UI — likely wrong hook or missing render config |
| MS Agent Framework (Python) | Tool Rendering | `Expected 0 arguments, but got 1`. Resolved by removing `/v2`. |
| MS Agent Framework (Python) | State Rendering | `Expected 0 type arguments, but got 1`. `agentState` implicitly `any`. `search`/`index` params implicitly `any`. |
| AWS Strands | Tool Rendering | `useRenderToolCall`: `Expected 0 arguments, but got 1`. `useRenderTool` doesn't show in UI (agent backend tool works, results visible but no fancy tool call rendering). |

### 3d. `useFrontendTool` parameter type mismatch (Mastra)

| Integration | Page | Error |
|---|---|---|
| Mastra | Generative UI > Tool Rendering | `Property 'context' does not exist on type '{ location: string; }'` in `createTool()` |
| Mastra | Generative UI > State Rendering | Same — `Property 'context' does not exist on type '{ query: string; }'` |
| Mastra | App Control > Frontend Tools | Type mismatch: array literal passed where `ZodType<Record<string, unknown>>` expected in `useFrontendTools()` parameters field |
| Agno | App Control > Frontend tools | `Cannot read properties of undefined (reading 'typeName')` — likely same root cause |
| MS Agent Framework (.NET) | App Control > Frontend Tools | `Cannot read properties of undefined (reading 'typeName')` — same pattern |
| MS Agent Framework (Python) | App Control > Frontend Tools | Same ZodType mismatch: array literal passed where `ZodType<Record<string, unknown>>` expected |
| AWS Strands | App Control > Frontend Tools | Same ZodType mismatch + handler type error: `Type '({ name }) => string'` not assignable to `'(args, context: FrontendToolHandlerContext) => Promise<unknown>'` |

### 3e. `CopilotChatLabels` type — `welcomeMessageText`

V2's `CopilotChatLabels` **does** include `welcomeMessageText`. V1's `CopilotChatLabels` does **not**. If the user is mixing V1 UI components with V2 types (or vice versa), this will fail.

| Integration | Page | Error |
|---|---|---|
| LlamaIndex | Workflow execution / Predictive state | `welcomeMessageText does not exist in type CopilotChatLabels` — likely using V1 type |

---

## Category 4: CLI `create` command — missing framework options

**Root cause:** The CLI (`npx copilotkit@latest create -f <framework>`) doesn't include all documented integrations as valid `--framework` values.

**Fix direction:** Update the CLI to support all integration IDs from `INTEGRATION_ORDER` in `docs/lib/integrations.ts`.

| Integration | Page | Error |
|---|---|---|
| Built-in Agent | Quickstart (CLI) | `--framework=built-in-agent` not recognized. Valid options don't include it. |
| Open Spec Agent | Quickstart | `agent-spec` not recognized as valid framework option |

---

## Category 5: Runtime / agent configuration issues (not export/docs bugs)

**Root cause:** These are runtime errors caused by misconfiguration, missing services, or upstream library issues — not incorrect imports or missing exports.

**Fix direction:** Improve docs with troubleshooting notes, prerequisites, and clearer setup instructions.

### 5a. "Failed to load graph: graph is nullish"

Occurs when the LangGraph agent process isn't running or `graph_id` doesn't match.

| Integration | Page | Notes |
|---|---|---|
| LangGraph | Generative UI > Display-only (prebuilt JS) | `{ graph_id: 'starterAgent' }` — graph not found |
| LangGraph | Generative UI > Interactive (prebuilt JS) | Same |
| LangGraph | App Control > Frontend actions (prebuilt JS) | Same |
| LangGraph | App Control > Readables (prebuilt JS) | Same |

### 5b. Agent not running / misconfigured

**Note on ADK:** The ADK `useAgent` errors persist even when the agent name is correctly set to `my_agent`. This suggests a deeper issue — possibly `useAgent` from the V2 import path doesn't resolve agents the same way, or the ADK agent registration path doesn't match what V2's runtime sync expects. Confirmed via Loom video — this may be a code bug, not just a docs issue.

| Integration | Page | Error |
|---|---|---|
| LangGraph | Quickstart (LangSmith) | "Agent is not running" |
| LangGraph | Configurable | `[agent_node] auth_token: None` — missing env var |
| LangGraph | App Control > Readables (prebuilt PY) | No error, just doesn't work as expected |
| Mastra | Generative UI > State Rendering | `useAgent: Agent 'default' not found after runtime sync` — agent name mismatch (`myAgent` registered, `default` expected) |
| Mastra | Shared State > Reading/Writing | `Cannot read properties of undefined (reading 'language')` — agent state not initialized |
| LlamaIndex | App Control (Frontend Tools) | No terminal errors, `alert("hello")` not showing — likely browser security or hook not triggering |
| ADK | State Rendering | `useAgent: Agent 'default' not found` — known agents: `[my_agent]`. Does not work even when agent name is set to `my_agent` (confirmed in Loom) |
| ADK | Shared State > Reading | Same `useAgent` error — persistent even with correct agent name |
| ADK | Shared State > Writing | Same |
| ADK | Workflow execution | Same |
| ADK | Predictive state updates | Same |
| MS Agent Framework (.NET) | State Rendering | `Cannot read properties of undefined (reading 'Searches')` |
| MS Agent Framework (.NET) | Shared State > Reading | `Cannot read properties of undefined (reading 'language')` |
| MS Agent Framework (.NET) | Shared State > Writing | Same |
| AWS Strands | State Rendering | Python SDK errors: `Agent.__init__()` got unexpected kwargs `state_schema`, `initial_state`, `instructions`. After resolving → `useAgent: Agent 'default' not found` (known agents: `[strands_agent]`) |
| AWS Strands | Shared State > Reading | Same `Agent.__init__()` errors + `useAgent` agent-not-found after fixing |
| AWS Strands | Shared State > Writing | Same |

### 5c. LibSQLStore configuration

| Integration | Page | Error |
|---|---|---|
| Mastra | Generative UI > State Rendering | `LibSQLStore: id must be provided and cannot be empty` |
| Mastra | Shared State > Reading/Writing | Same |

### 5d. CrewAI Flows — Pydantic alias warning

| Integration | Page | Error |
|---|---|---|
| CrewAI Flows | Quickstart (CLI) | Pydantic warning: `alias` attribute (`forwardedProps`) passed to `Field()` has no effect. Upstream issue. |

### 5e. AWS Strands — Python SDK `Agent()` kwargs don't exist

The docs show `Agent(state_schema=..., initial_state=..., instructions=...)` but the Strands `Agent.__init__()` doesn't accept these kwargs. This is a doc/SDK mismatch — the examples were likely written against a different version or a generic pattern.

| Integration | Page | Error |
|---|---|---|
| AWS Strands | State Rendering | `TypeError: Agent.__init__() got unexpected keyword argument 'state_schema'` (also `initial_state`, `instructions`) |
| AWS Strands | Shared State > Reading | Same |
| AWS Strands | Shared State > Writing | Same |

### 5f. A2A — agent spawn path wrong

| Integration | Page | Error |
|---|---|---|
| A2A | Guides | Agent tries to run `src/main.py` but file is at root level. Turbopack errors persist even after fix. |

---

## Category 6: Missing dependencies in quickstart instructions

**Root cause:** Required npm packages not listed in setup steps.

| Integration | Page | Error |
|---|---|---|
| Mastra | Quickstart (Existing Agent) | `Can't resolve '@ai-sdk/openai'` — package not in install instructions |

---

## Summary by severity

| Priority | Category | Issue count | Effort |
|---|---|---|---|
| **P0** | Cat 1: `CopilotKit` not in V2 | 7 reports | Small — update docs to V1 import path |
| **P0** | Cat 2: V1-only hooks on `/v2` path | 8 reports | Medium — update docs to V2 equivalents |
| **P1** | Cat 3: API shape mismatches | 20 reports | Medium — fix doc code snippets |
| **P1** | Cat 4: CLI missing frameworks | 2 reports | Small — update CLI validation |
| **P1** | Cat 5: Runtime/config issues | 27 reports | Varies — document for team |
| **P2** | Cat 6: Missing dependencies | 1 report | Trivial — add to install instructions |

**Total: ~65 issue reports across 14 integrations**

### Cross-cutting patterns

1. **ADK `useAgent` resolution failure** — 5+ pages, persists even with correct agent name. Likely a code bug.
2. **AWS Strands Python SDK mismatch** — `Agent.__init__()` doesn't accept `state_schema`/`initial_state`/`instructions` kwargs shown in docs. After fixing → still hits `useAgent` agent-not-found.
3. **`useFrontendTool` / frontend tools parameter type** — Consistent across Mastra, Agno, MS Agent Framework (.NET), MS Agent Framework (Python), AWS Strands. Docs pass plain arrays where Zod schemas are expected. Handler return types also wrong (sync string vs async Promise).
