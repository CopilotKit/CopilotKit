"""PydanticAI agent for the CopilotKit MCP Apps demo.

This agent has no bespoke tools — the CopilotKit runtime is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server (see ``src/app/api/copilotkit-mcp-apps/route.ts``). The runtime
auto-applies the MCP Apps middleware, which exposes the remote MCP
server's tools to this agent at request time as frontend-defined tools.
PydanticAI's AG-UI bridge surfaces those tools to the model on each run,
the model decides when to call them, and CopilotKit's built-in
``MCPAppsActivityRenderer`` renders the resulting activity events
inline as a sandboxed iframe.

Reference:
https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
"""

from __future__ import annotations

from textwrap import dedent

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIResponsesModel


SYSTEM_PROMPT = dedent(
    """
    You draw simple diagrams in Excalidraw via the MCP tool.

    SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize
    for polish. Target: one tool call, done in seconds.

    When the user asks for a diagram:
    1. Call `create_view` ONCE with 3-5 elements total: shapes + arrows
       + an optional title text.
    2. Use straightforward shapes (rectangle, ellipse, diamond) with
       plain `label` fields (`{"text": "...", "fontSize": 18}`) on them.
    3. Connect with arrows. Endpoints can be element centers or simple
       coordinates — you don't need edge anchors / fixedPoint bindings.
    4. Include ONE `cameraUpdate` at the END of the elements array that
       frames the whole diagram. Use an approved 4:3 size (600x450 or
       800x600). No opening camera needed.
    5. Reply with ONE short sentence describing what you drew.

    Every element needs a unique string `id` (e.g. `"b1"`, `"a1"`,
    `"title"`). Standard sizes: rectangles 160x70, ellipses/diamonds
    120x80, 40-80px gap between shapes.

    Do NOT:
    - Call `read_me`. You already know the basic shape API.
    - Make multiple `create_view` calls.
    - Iterate or refine. Ship on the first shot.
    - Add decorative colors / fills / zone backgrounds unless the user
      explicitly asks for them.
    - Add labels on arrows unless crucial.

    If the user asks for something specific (colors, more elements,
    particular layout), follow their lead — but still in ONE call.
    """
).strip()


# gpt-4o-mini for speed — Excalidraw element emission is simple JSON
# and we're biasing hard toward sub-30s generation. A faster model
# produces shorter, quicker outputs with acceptable layouts.
agent = Agent(
    model=OpenAIResponsesModel("gpt-4o-mini"),
    system_prompt=SYSTEM_PROMPT,
)
