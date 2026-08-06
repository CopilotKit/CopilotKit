# CrewAI Flows parity notes

The stable `crewai-crews` slug now represents the regular CrewAI Flows
showcase column. It implements all 41 runnable D6 demos and keeps the legacy
slug for existing links and deployment wiring.

## Execution contract

- Feature-specific routes run through regular CrewAI Flow `kickoff` or
  `astream` execution.
- The integration is pinned to `ag-ui-crewai==0.2.2a1`,
  `ag-ui-protocol==0.1.19`, and `crewai==1.15.11`.
- All model-backed showcase paths use `gpt-5.4`.
- The alpha bridge owns AG-UI event translation for text, reasoning, tools,
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
