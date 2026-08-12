# QA — declarative-gen-ui

## Scope

Manual QA checklist for the `declarative-gen-ui` demo in the AWS Strands showcase. The
Strands package reuses a single shared agent for every demo, so this stub
exists primarily to document the human verification path.

## Happy path

- [ ] Navigate to `/demos/declarative-gen-ui`.
- [ ] Verify the page renders without console errors.
- [ ] Exercise the demo's primary interaction (see README for the
      LangGraph-Python equivalent demo — same user flow).

## Regression

- [ ] No hydration warnings in the browser console.
- [ ] The shared Strands agent responds with text within a few seconds.

## Known gaps

- Port of the LangGraph-Python `declarative-gen-ui` demo; backend differentiation is
  collapsed into the shared `src/agents/agent.py`.
