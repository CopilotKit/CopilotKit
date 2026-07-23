# QA — headless-simple

## Scope

Manual QA checklist for the `headless-simple` demo in the AWS Strands showcase. The
Strands package reuses a single shared agent for every demo, so this stub
exists primarily to document the human verification path.

## Happy path

- [ ] Navigate to `/demos/headless-simple`.
- [ ] Verify the page renders without console errors.
- [ ] Exercise the demo's primary interaction (see README for the
      LangGraph-Python equivalent demo — same user flow).

## Regression

- [ ] No hydration warnings in the browser console.
- [ ] The shared Strands agent responds with text within a few seconds.

## Known gaps

- Port of the LangGraph-Python `headless-simple` demo; backend differentiation is
  collapsed into the shared `src/agents/agent.py`.
