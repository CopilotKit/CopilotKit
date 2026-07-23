"""
LangGraph agent for the CopilotKit MCP Apps demo.

This agent has no bespoke tools — the CopilotKit runtime is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server (see ``src/app/api/copilotkit-mcp-apps/route.ts``). The runtime
auto-applies the MCP Apps middleware, which exposes the remote MCP
server's tools to this agent at request time and emits the activity
events that CopilotKit's built-in ``MCPAppsActivityRenderer`` renders in
the chat as a sandboxed iframe.

Reference:
https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

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


graph = create_agent(
    # gpt-4o-mini for speed — Excalidraw element emission is simple
    # JSON and we're biasing hard toward sub-30s generation. A faster
    # model produces shorter, quicker outputs with acceptable layouts.
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
