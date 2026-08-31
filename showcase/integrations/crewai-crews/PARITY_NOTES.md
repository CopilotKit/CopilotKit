# CrewAI Flows parity notes

The stable `crewai-crews` slug now represents the regular CrewAI Flows
showcase column. It implements all 41 runnable D6 demos and keeps the legacy
slug for existing links and deployment wiring.

## Execution contract

- Feature-specific routes run through regular CrewAI Flow `kickoff` or
  `astream` execution.
- Cells with no feature-specific backend (chrome, headless, slots, CSS, auth,
  voice, agent-config) share the neutral chat Flow on `/chat`. Every demo route
  is served by `add_crewai_flow_fastapi_endpoint`, so no cell inherits CrewAI's
  crew-chat system prompt. The remaining crew endpoints (`/mcp-apps`,
  `/byoc-hashbrown`, `/byoc-json-render`) each override that prompt explicitly.
- There is no root catch-all endpoint: a demo whose agent name is not routed
  fails loudly instead of silently landing on someone else's backend.
- The integration is pinned to the official `ag-ui-crewai==0.3.0` release,
  `ag-ui-protocol==0.1.19`, and `crewai==1.15.11`.
- All model-backed showcase paths use `gpt-5.4`.
- The integration bridge owns AG-UI event translation for text, reasoning, tools,
  state, interrupts, multimodal input, and generative UI.

## Conversational sibling

`crewai-conversational-flows` presents the same frontend demos and shared D6
probes as a separate column. Its backend enters CrewAI through the public
`stream_turn(message, session_id=...)` API instead of regular Flow execution.
Keeping the columns separate makes the runtime path visible without changing
the user-facing feature contract.

## Fixtures and probes

Both columns use integration-scoped deterministic fixtures and the same shared
D6 probes. Framework-specific variation stays in the CrewAI backend and its
fixture directory; the frontend assertions remain aligned with the LangGraph
Python reference column.
