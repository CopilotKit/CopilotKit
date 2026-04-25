# QA — tool-rendering-custom-catchall

## Scope

Manual QA checklist for the `tool-rendering-custom-catchall` demo in the AWS Strands showcase. The
Strands package reuses a single shared agent for every demo, so this stub
exists primarily to document the human verification path.

## Happy path

- [ ] Navigate to `/demos/tool-rendering-custom-catchall`.
- [ ] Verify the page renders without console errors.
- [ ] Exercise the demo's primary interaction (see README for the
      LangGraph-Python equivalent demo — same user flow).

## Regression

- [ ] No hydration warnings in the browser console.
- [ ] The shared Strands agent responds with text within a few seconds.

## Known gaps

- Port of the LangGraph-Python `tool-rendering-custom-catchall` demo; backend differentiation is
  collapsed into the shared `src/agents/agent.py`.
