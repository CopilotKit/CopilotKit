# QA: Open-Ended Generative UI — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/open-gen-ui`
- [ ] Verify the chat renders with minimal suggestions visible
- [ ] Click the "3D axis visualization (model airplane)" suggestion
- [ ] Verify a sandboxed iframe appears with the generated visualization

### 2. Feature-Specific Checks

- [ ] Verify the iframe contains SVG-based content (not div-stacks)
- [ ] Try the "Quicksort visualization" suggestion — verify an animated bar sort renders
- [ ] Verify the visualization is self-running (no user interaction needed)

### 3. Error Handling

- [ ] Verify no CORS/CSP errors in the console
- [ ] Verify the sandbox iframe renders within the chat turn

## Expected Results

- Agent calls `generateSandboxedUi` once per turn
- The runtime's OpenGenerativeUIMiddleware converts the call into activity events
- The built-in renderer mounts the agent-authored HTML inside a sandbox
