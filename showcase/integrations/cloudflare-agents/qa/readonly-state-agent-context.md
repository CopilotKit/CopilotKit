# QA — readonly-state-agent-context

## Scope

Manual QA checklist for the `readonly-state-agent-context` demo in the Cloudflare Agents showcase. The
Cloudflare Agents package reuses a single shared agent for most demos, so this stub
exists primarily to document the human verification path.

## Happy path

- [ ] Navigate to `/demos/readonly-state-agent-context`.
- [ ] Verify the page renders without console errors.
- [ ] Exercise the demo's primary interaction (see README for the
      LangGraph-Python equivalent demo — same user flow).

## Regression

- [ ] No hydration warnings in the browser console.
- [ ] The shared Cloudflare agent responds with text within a few seconds.

## Known gaps

- Port of the LangGraph-Python `readonly-state-agent-context` demo; backend differentiation is
  collapsed into the shared `src/agents/agent.py`.
