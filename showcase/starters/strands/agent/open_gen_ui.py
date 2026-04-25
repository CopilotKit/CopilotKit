"""Strands agent specialization for the open-gen-ui demos (Wave 2).

Minimal and Advanced variants share the same core behavior: on every user
turn, the agent calls the frontend-registered `generateSandboxedUi` tool
exactly once, producing a self-contained sandboxed UI cell.

The runtime's `OpenGenerativeUIMiddleware` (enabled via the
`openGenerativeUI` option on the CopilotRuntime in
`src/app/api/copilotkit-ogui/route.ts`) converts that streaming tool call
into `open-generative-ui` activity events.

Since the shared Strands agent dispatches the frontend-registered tool via
the ag_ui_strands proxy, no dedicated Python Agent instance is required.
This module documents the system prompt that specializes the shared agent
via `useAgentContext` on the frontend.
"""

OPEN_GEN_UI_SYSTEM_PROMPT = """\
You are a UI-generating assistant for an Open Generative UI demo. On every
user turn you MUST call the `generateSandboxedUi` frontend tool exactly once.
Design a visually polished, self-contained HTML + CSS + SVG widget that
teaches the requested concept.

The frontend injects a detailed "design skill" as agent context describing
the palette, typography, labelling, and motion conventions expected —
follow it closely. Key invariants:

- Output ONE call to `generateSandboxedUi` per user turn.
- Respect the `initialHeight`, `placeholderMessages`, `css`, `html`
  contract defined by the design skill.
- For the advanced variant, the frontend may register sandbox functions
  the iframe can call via `Websandbox.connection.remote.<name>(...)`. Use
  these where it makes the demo visibly exercise the iframe <-> host
  bridge.
"""

def build_open_gen_ui_agent():
    """Build a Strands Agent for the open-gen-ui demos.

    Not currently wired into agent_server.py; the shared agent handles the
    `generateSandboxedUi` tool call via ag_ui_strands' frontend-tool proxy.
    This module's prompt is mirrored by the frontend design skill passed to
    CopilotKit's `openGenerativeUI.designSkill`.
    """
    from strands import Agent
    from strands.models.openai import OpenAIModel
    import os

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY must be set for the open-gen-ui Strands agent"
        )
    model = OpenAIModel(
        client_args={"api_key": api_key},
        model_id="gpt-4o",
    )
    return Agent(
        model=model,
        system_prompt=OPEN_GEN_UI_SYSTEM_PROMPT,
        tools=[],
    )
