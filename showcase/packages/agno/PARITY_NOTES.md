# Agno — Parity Notes

Tracking notes for feature-matrix parity between this package and
`showcase/packages/langgraph-python/` (canonical reference).

## Ported

See `manifest.yaml` for the authoritative list.

## Skipped

The following demos from the canonical LangGraph-Python reference are intentionally
NOT ported to this package. Each has a concrete reason tied to a genuine framework
capability difference.

- `gen-ui-interrupt` — Uses LangGraph's `interrupt()` primitive to pause the graph
  mid-run and resolve from the UI. Agno's AgentOS does not expose an equivalent
  long-running-resume primitive over AG-UI at this time. We already ship
  `hitl-in-chat` which covers the same user-facing HITL scenario via Agno's
  native tool-approval path.

- `interrupt-headless` — Same root cause as `gen-ui-interrupt`. Headless resume
  from a button grid requires a pause/resume handle the Agno AGUI adapter does
  not currently surface.

- `cli-start` — This is not a real demo; it's a copy-paste starter command that
  the dashboard renders as its own card entry without a route or backing agent.
  The equivalent starter for Agno is published separately at
  `showcase/starters/agno` and is already advertised via `manifest.yaml`'s
  `starter:` section.
