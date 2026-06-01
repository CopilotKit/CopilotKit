"""AG2 agent for the CopilotKit MCP Apps demo.

This agent has no bespoke tools. The CopilotKit runtime (see
`src/app/api/copilotkit-mcp-apps/route.ts`) is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server. The runtime auto-applies the MCP Apps middleware: it merges the
remote MCP server's tools into the agent's tool list at request time and
emits the activity events that CopilotKit's built-in
``MCPAppsActivityRenderer`` renders inline as a sandboxed iframe.

Mirrors the langgraph-python `mcp_apps_agent.py` — a no-tools agent that
relies entirely on the runtime to inject MCP-backed tools.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI


SYSTEM_PROMPT = """\
You draw simple diagrams in Excalidraw via the MCP tool.

SPEED MATTERS. Produce a correct-enough diagram fast; do not optimize
for polish. Target: one tool call, done in seconds.

When the user asks for a diagram:
1. Call `create_view` ONCE with 3-5 elements total: shapes + arrows +
   an optional title text.
2. Use straightforward shapes (rectangle, ellipse, diamond) with plain
   `label` fields (`{"text": "...", "fontSize": 18}`) on them.
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


agent = ConversableAgent(
    name="mcp_apps_assistant",
    system_message=SYSTEM_PROMPT,
    # gpt-4o-mini for speed, mirroring the langgraph reference.
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=6,
    # No bespoke tools — MCP server tools are injected by the runtime
    # middleware at request time.
    functions=[],
)

stream = AGUIStream(agent)
mcp_apps_app = FastAPI()
mcp_apps_app.mount("", stream.build_asgi())
