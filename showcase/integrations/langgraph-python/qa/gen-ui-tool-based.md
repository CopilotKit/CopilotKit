# QA: Tool-Based Generative UI — LangGraph (Python)

The demo registers two `useComponent` renderers (`render_bar_chart`,
`render_pie_chart`) on a centered `<CopilotChat>`. The agent emits
chart-shaped tool calls and the frontend materializes them as Recharts
SVG inside the assistant message bubble.

## Prerequisites

- Demo is deployed and accessible at `/demos/gen-ui-tool-based`
- Agent backend is healthy (`/api/health`)

## Test Steps

### 1. Initial render

- [ ] Navigate to `/demos/gen-ui-tool-based`
- [ ] Verify the chat composer mounts (`textarea` with placeholder
      matching `/message/i`)
- [ ] Verify all three suggestion pills are visible
      (`data-testid="copilot-suggestion"`):
  - "Sales bar chart"
  - "Traffic pie chart"
  - "Market share"

### 2. Bar chart flow

- [ ] Click the "Sales bar chart" suggestion (or type "Show me a bar
      chart of monthly expenses")
- [ ] Verify the assistant message bubble
      (`[data-testid="copilot-assistant-message"]`) renders, and its inner
      Recharts SVG is visible

### 3. Pie chart flow

- [ ] Click the "Traffic pie chart" or "Market share" suggestion
- [ ] Verify the assistant message bubble renders an SVG (the donut
      pie) inside

### 4. Free-form chat

- [ ] Type "Hello" and press Enter
- [ ] Verify the assistant streams back a text response in a fresh
      `[data-testid="copilot-assistant-message"]` bubble

### 5. Hygiene

- [ ] No console errors during normal usage
- [ ] No layout breakage with a very long input

## Expected Results

- Chat composer mounts within ~3 seconds
- Suggestion pills render alongside an empty chat
- Tool-driven chart bubbles materialize within ~30 seconds for short
  prompts; the SVG renders progressively as Recharts mounts
