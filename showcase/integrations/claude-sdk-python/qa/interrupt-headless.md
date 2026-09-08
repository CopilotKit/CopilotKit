# QA: Interrupt (Headless) — Claude Agent SDK (Python)

> Stub — authored for column completeness. This is a testing-kind demo
> (see `kind: "testing"` in `showcase/shared/feature-registry.json`) and
> does not warrant a full manual checklist. The cell is additionally
> quarantined under `not_supported_features` in `manifest.yaml` (shared
> upstream `@copilotkit/react-core/v2` resume-path defect).

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy; `ANTHROPIC_API_KEY` set. The cell uses the shared
  `/api/copilotkit` runtime with agent `interrupt-headless`, mapped to the
  FastAPI `POST /interrupt-adapted` endpoint (`src/agents/interrupt_agent.py`)

## Test Steps

- [ ] Navigate to /demos/interrupt-headless and verify the left app surface
      (`data-testid="interrupt-headless-app-surface"`) shows the empty state
      (`data-testid="interrupt-headless-empty"`, "Nothing scheduled yet")
- [ ] Send a scheduling prompt (e.g. the "Book a call with sales" pill) and verify a time-slot picker popup (`data-testid="interrupt-headless-popup"`) appears in the left app surface, not in the chat
- [ ] Click one of the time-slot buttons and verify the popup disappears and the agent confirms the booking back in the chat

## Expected Results

- Page loads without errors
- Interrupt resolves via the plain button grid (no `useInterrupt` render prop, no in-chat picker) and the agent continues the run with the picked slot
- Known deviation: the turn-2 confirmation bubble may never append — that is the quarantined react-core resume-path bug, not an integration regression
