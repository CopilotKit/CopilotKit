# Open Generative UI

## What This Demo Shows

The simplest possible Open Generative UI setup — enabling
`openGenerativeUI` in the runtime is all that's needed. The runtime
middleware streams agent-authored HTML + CSS to the built-in
`OpenGenerativeUIActivityRenderer`, which mounts the result inside a
sandboxed iframe.

## How to Interact

Try one of the suggestion pills, or ask for any educational visualisation
("Visualise how a binary search tree is built", "Animate a sine wave").

## Technical Details

- Runtime: `src/app/api/copilotkit-ogui/route.ts` — sets
  `openGenerativeUI.agents` so the middleware applies to the listed
  agents.
- Agent: `src/agents/open_gen_ui_agent.py` — a no-tools Agno agent. The
  middleware injects the `generateSandboxedUi` tool the LLM uses.
- Frontend: passes `openGenerativeUI.designSkill` to the provider so the
  LLM follows our visualisation-tuned design rules.
