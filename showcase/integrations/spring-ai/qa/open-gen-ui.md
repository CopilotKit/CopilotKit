# QA: Open-Ended Generative UI — Spring AI

## Prerequisites

- Demo is deployed and accessible
- OPENAI_API_KEY is set on the Spring backend

## Test Steps

- [ ] Navigate to `/demos/open-gen-ui`
- [ ] Click a suggestion (e.g. "3D axis visualization")
- [ ] Verify a sandboxed iframe renders an educational visualisation inside the chat stream
- [ ] Confirm the visualisation is self-running (no host-side functions required)

## Expected Results

- Agent streams HTML + CSS into the built-in OpenGenerativeUIActivityRenderer
- The iframe mounts and animates without user interaction
