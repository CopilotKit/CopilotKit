# A2UI — Fixed Schema

The component tree (schema) is authored ahead of time in
`src/agents/a2ui_schemas/flight_schema.json` and shipped with the backend.
The agent (`src/agents/a2ui_fixed.py`) only streams DATA into the data model
at runtime via the `display_flight` tool, which emits an `a2ui_operations`
container directly in the tool result.

The dedicated runtime route (`/api/copilotkit-a2ui-fixed-schema`) runs with
`a2ui.injectA2UITool: false` because the backend owns the rendering tool;
the A2UI middleware still detects the operations container and forwards
surfaces to the frontend catalog wired via `<CopilotKit a2ui={{ catalog }}>`.
