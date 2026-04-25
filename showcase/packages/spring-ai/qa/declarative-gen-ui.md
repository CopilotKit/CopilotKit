# QA: Declarative Generative UI — Spring AI

## Prerequisites

- Spring AI backend is up with the `generate_a2ui` tool registered
- OPENAI_API_KEY is set (the dynamic-A2UI tool makes a secondary LLM call)

## Test Steps

- [ ] Navigate to `/demos/declarative-gen-ui`
- [ ] Click the "Show a KPI dashboard" suggestion
- [ ] Verify a dashboard with 3-4 metric cards renders inline
- [ ] Click the "What's the weather like?" suggestion (or similar)
- [ ] Verify the agent generates a branded UI card using the catalog components

## Expected Results

- `a2ui.injectA2UITool: false` keeps the tool owned by the Spring backend
- Catalog schema is serialized into `copilotkit.context` so the Spring tool's LLM knows available components
- Rendered components match the catalog definitions in `./a2ui/renderers.tsx`
