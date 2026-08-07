# AWS Strands — LangGraph-Python Parity Notes

This file documents the status of each showcase demo relative to the
canonical LangGraph-Python showcase package (`showcase/integrations/langgraph-python`).

## Architecture (D6)

Strands no longer runs every demo against a single shared backend. As of the
D6 wire-server pass:

- **Shared showcase agent** (`src/agents/agent.py`) remains mounted at `/` for
  chrome / frontend-tool / generic tool-rendering cells.
- **Specialized agents** live under `src/agents/<demo>.py` and are mounted as
  FastAPI sub-apps in `src/agent_server.py`. The main Next.js runtime
  (`src/app/api/copilotkit/route.ts`) maps `agent=` names onto those mounts
  via distinct `HttpAgent` URLs — same pattern as ms-agent-python / LGP.
- **Dedicated Next.js runtimes** still own global flags that must not bleed
  into chrome demos: A2UI, openGenerativeUI, mcpApps, beautiful-chat combined,
  voice, multimodal, auth, agent-config.

### Mount map (`agent_server.py`)

| Mount path                        | Factory / agent                              | Used by                                    |
| --------------------------------- | -------------------------------------------- | ------------------------------------------ |
| `/`                               | `build_showcase_agent`                       | default + neutral cells                    |
| `/reasoning`                      | `build_reasoning_agent`                      | `reasoning-default`, `reasoning-custom`    |
| `/tool-rendering-reasoning-chain` | `build_tool_rendering_reasoning_chain_agent` | `tool-rendering-reasoning-chain`           |
| `/shared-state-streaming`         | `build_shared_state_streaming_agent`         | `shared-state-streaming`                   |
| `/hitl-in-chat`                   | `build_hitl_in_chat_agent`                   | `hitl-in-chat`                             |
| `/open-gen-ui`                    | `build_open_gen_ui_agent`                    | `open-gen-ui` (via `/api/copilotkit-ogui`) |
| `/open-gen-ui-advanced`           | `build_open_gen_ui_advanced_agent`           | `open-gen-ui-advanced`                     |
| `/beautiful-chat`                 | showcase agent alias                         | `/api/copilotkit-beautiful-chat`           |
| `/mcp-apps`                       | showcase agent alias                         | `/api/copilotkit-mcp-apps`                 |
| `/headless-complete`              | showcase agent alias                         | headless-complete on mcp-apps runtime      |
| `/a2ui-recovery`                  | `build_a2ui_recovery_agent`                  | a2ui-recovery                              |
| `/declarative-gen-ui`             | `build_a2ui_dynamic_agent`                   | declarative-gen-ui                         |
| `/a2ui-fixed-schema`              | `build_a2ui_fixed_schema_agent`              | a2ui-fixed-schema                          |
| `/byoc-hashbrown`                 | `build_byoc_hashbrown_agent`                 | declarative-hashbrown                      |
| `/byoc-json-render`               | `build_byoc_json_render_agent`               | declarative-json-render                    |
| `/voice`                          | `build_voice_agent`                          | voice                                      |

## Skipped demos (matches LGP)

These demos depend on a resume-path bug in `@copilotkit/react-core/v2` that
also blocks the LGP reference integration. Surfaced as
`not_supported_features` only — demos remain wired:

- **gen-ui-interrupt** — `useInterrupt` / low-level interrupt lifecycle.
  Backend resumes + streams (HTTP 200) but the frontend never appends the
  confirmation assistant bubble. Published-package fix is out of scope.
- **interrupt-headless** — Same rationale as `gen-ui-interrupt`.

No other features are listed in `not_supported_features`. In particular
`shared-state-streaming`, `reasoning-default`, `reasoning-custom`, and
`tool-rendering-reasoning-chain` are **supported** as of D6.

## Feature name alignment with LGP

| LGP id                           | Strands status                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `reasoning-default`              | Supported (was previously missing / misnamed)                                        |
| `reasoning-custom`               | Supported (was `agentic-chat-reasoning`)                                             |
| `tool-rendering-reasoning-chain` | Supported (was not_supported)                                                        |
| `shared-state-streaming`         | Supported (was not_supported)                                                        |
| `hitl-in-chat`                   | Supported (dedicated agent mount)                                                    |
| `hitl-in-chat-booking`           | Removed — LGP has no separate booking feature id; the booking flow is `hitl-in-chat` |

Legacy Strands ids `reasoning-default-render` and `agentic-chat-reasoning` are
gone; demos live under `/demos/reasoning-default` and `/demos/reasoning-custom`.

## Ported demos

### Specialized-backend cells (D6)

- `reasoning-default` — built-in `CopilotChatReasoningMessage`; backend
  `/reasoning`.
- `reasoning-custom` — custom `ReasoningBlock` slot; same `/reasoning` backend.
- `tool-rendering-reasoning-chain` — tools + reasoning tokens side-by-side;
  backend `/tool-rendering-reasoning-chain`.
- `shared-state-streaming` — per-token state delta streaming; backend
  `/shared-state-streaming`.
- `hitl-in-chat` — `useHumanInTheLoop` booking flow; backend `/hitl-in-chat`.
- `open-gen-ui` / `open-gen-ui-advanced` — dedicated agents + `/api/copilotkit-ogui`.
- `a2ui-recovery` — validate→retry recovery loop; backend `/a2ui-recovery`.
- `declarative-gen-ui` / `a2ui-fixed-schema` — dedicated A2UI agents.
- `declarative-hashbrown` / `declarative-json-render` — BYOC specialized agents.
- `beautiful-chat` — combined runtime (`openGenerativeUI` + `a2ui` + `mcpApps`)
  at `/api/copilotkit-beautiful-chat` → `/beautiful-chat/`.
- `mcp-apps` / `headless-complete` — `/api/copilotkit-mcp-apps` → alias mounts.
- `voice` — tool-free agent at `/voice`.

### Shared-agent / frontend-driven cells

- `agentic-chat`, `chat-customization-css`, `prebuilt-sidebar`,
  `prebuilt-popup`, `chat-slots`, `headless-simple`
- `frontend-tools`, `frontend-tools-async`
- `hitl` (step-based), `hitl-in-app`
- `tool-rendering`, `tool-rendering-default-catchall`,
  `tool-rendering-custom-catchall`
- `gen-ui-agent`, `gen-ui-tool-based`
- `shared-state-read`, `shared-state-read-write`,
  `readonly-state-agent-context`
- `subagents`, `multimodal`, `auth`, `agent-config`
- `cli-start` — manifest-only start command

### Caveats

- **Reasoning on Strands** uses Chat Completions + a native reasoning model
  (`OPENAI_REASONING_MODEL`, default `gpt-5.5`) with `reasoning_effort=medium`.
  LGP uses the Responses API for richer reasoning summaries; Strands
  `OpenAIModel` has no Responses-API path yet. `ag_ui_strands` still maps
  `reasoningText` → `REASONING_MESSAGE_*` when the model streams reasoning
  content.
- **Beautiful-chat** reuses the showcase agent tooling (including backend-owned
  `generate_a2ui`) rather than a separate graph file; the dedicated runtime
  enables the combined flag surface. Full LGP canvas parity was brought in
  via the ui-parity slot.
- **BYOC demos** may still inject catalog prompts via `useAgentContext` as a
  belt-and-suspenders path; primary specialization is the dedicated agent
  mount + Next.js route.
