# Declarative Generative UI (A2UI — Dynamic Schema)

The backend agent (`src/agents/a2ui_dynamic.py`) owns the `generate_a2ui`
tool explicitly. When called, it invokes a secondary OpenAI client bound to
the `render_a2ui` schema (forced via `tool_choice`) which produces an
`a2ui_operations` container.

The dedicated runtime route (`/api/copilotkit-declarative-gen-ui`) sets
`a2ui.injectA2UITool: false` so the runtime does NOT auto-inject another
A2UI tool on top — the A2UI middleware still serialises the registered
client catalog into `copilotkit.context` and forwards the rendered
operations to the frontend renderer wired via `<CopilotKit a2ui={{ catalog }}>`.
