# QA: Open-Ended Generative UI (Minimal) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Graph `open_gen_ui` is registered in the OGUI runtime (`api/copilotkit-ogui/route.ts`) with `openGenerativeUI.agents` including `"open-gen-ui"`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the open-gen-ui demo page
- [ ] Verify the `<CopilotChat>` renders full-height within the centered max-w-4xl container
- [ ] Verify the input composer is visible
- [ ] Send a basic message (e.g. "Hi")
- [ ] Verify the agent calls `generateSandboxedUi` and a sandboxed iframe is mounted inside the chat transcript
- [ ] Verify the streaming placeholder message(s) appear before the final UI renders

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "3D axis visualization (model airplane)" suggestion is visible
- [ ] Verify "How a neural network works" suggestion is visible
- [ ] Verify "Quicksort visualization" suggestion is visible
- [ ] Verify "Fourier: square wave from sines" suggestion is visible

#### Neural Network Prompt (concrete render)

- [ ] Click the "How a neural network works" suggestion
- [ ] Verify short placeholder lines show while streaming (e.g. "Sketching the scene…", "Labelling axes…", "Wiring up the animation…")
- [ ] Verify a sandboxed iframe activity is mounted in the assistant turn
- [ ] Inside the iframe, verify an inline `<svg>` element renders (not stacked `<div>`s)
- [ ] Verify three layers of nodes are visible (input ~4, hidden ~5, output ~2) with connecting lines
- [ ] Verify layer labels are present (e.g. "Input", "Hidden", "Output") and a "Forward pass" caption
- [ ] Verify activations animate (pulse forward from input to output in a loop) — indigo active, slate quiescent
- [ ] Verify the visualization loops continuously without user interaction

#### Quicksort Prompt (secondary render)

- [ ] In a fresh turn, click the "Quicksort visualization" suggestion
- [ ] Verify a new sandboxed iframe is rendered with ~10 SVG rect bars
- [ ] Verify a caption text element updates as the sort progresses (e.g. "Partition around pivot", "Swap", "Recurse left")
- [ ] Verify the pivot highlight uses amber (#f59e0b) and compared elements use indigo (#6366f1)

#### Design Skill Injection

- [ ] In any rendered output, verify the visualization respects the palette: indigo accent, emerald success, amber warning, slate neutrals
- [ ] Verify the outer container has a white background with rounded corners and padded content (no bleed to viewport edges)
- [ ] Verify the visualization includes a title line and subtitle line at the top

### 3. Error Handling

- [ ] Send a trivially off-topic prompt (e.g. "banana banana banana"); verify the agent still renders a sandboxed UI or a graceful text response — no unhandled exception
- [ ] Verify no console errors originating from the host page during rendering (sandbox-internal warnings may be present)
- [ ] Verify the sandbox iframe does NOT attempt fetch / XHR / localStorage (network tab: no origin-leaked requests from the iframe)
- [ ] Send an empty message — input should be rejected without error
- [ ] Refresh the page mid-stream — verify no broken UI persists

## Expected Results

- Chat loads within 3 seconds
- First visualization mounts within ~15 seconds of prompt submission
- Sandboxed iframe renders SVG-based content with labeled axes / layers / legend
- Animations loop smoothly with CSS keyframes (no jank from setInterval)
- No UI errors or broken layouts
