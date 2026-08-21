# CrewAI Conversational Flows parity notes

This package is the native turn-based sibling of `crewai-crews`. It preserves
the same 41 runnable showcase demos and frontend source while changing the
backend execution path from regular Flow kickoff or the legacy Crew wrapper to
CrewAI's public Conversational Flows API.

## Execution contract

- Every agent route is registered with `conversational=True`.
- Every served Flow declares `conversational = True` and exposes CrewAI's
  public `stream_turn(message, session_id=...)` method.
- AG-UI `threadId` is used as the CrewAI conversation `session_id`.
- The integration is pinned to the official `ag-ui-crewai==0.3.0` release and
  `crewai==1.15.11`.
- All model-backed showcase paths use `gpt-5.4`.

`src/agents/conversational_flows.py` adapts the regular Flow classes using the
same pattern as the upstream AG-UI Dojo. It keeps the feature logic inside the
existing Flow classes and adds only CrewAI's conversational routing behavior.

## Shared presentation and probes

The React demo components match the regular CrewAI column. Only runtime proxy
URLs and column-specific metadata differ. The D6 harness uses the same shared
probe scripts for both columns. Per-integration variation is limited to the
backend, runtime routing, and fixtures under
`showcase/aimock/d6/crewai-conversational-flows/`.

## Deployment

The manifest remains `deployed: false` until a dedicated Railway service is
provisioned. Local D6 verification runs through the
`crewai-conversational-flows` compose service on port 3120.
