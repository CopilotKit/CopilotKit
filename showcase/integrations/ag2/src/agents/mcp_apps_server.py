"""AG2 MCP server that serves an interactive MCP App.

This is the *server* half of the MCP Apps demo, built on `ag2.mcp`:

    - `MCPApp` binds a static HTML document (`ui://ag2/diagram`) to the tools
      that render it. A host reads the document as a resource in parallel with
      the tool call; the per-call data reaches it as `structuredContent` on the
      tool result, which the host redelivers to the sandboxed iframe.
    - `MCPServer(agent, apps=[...])` serves the app over streamable HTTP. It is
      an ASGI app, mounted by agent_server.py at `/mcp-apps-server` (endpoint
      `/mcp-apps-server/mcp`).

The CopilotKit runtime (`src/app/api/copilotkit-mcp-apps/route.ts`) points
`mcpApps.servers` at this endpoint. Its MCP Apps middleware merges the server's
tools into the chat agent's tool list, fetches the `ui://` resource when
`create_view` is called, and emits the activity event that CopilotKit's built-in
`MCPAppsActivityRenderer` paints as a sandboxed iframe.

The tool keeps the `create_view` name and `elements` shape of the other
integrations' MCP Apps demos so the shared frontend, probe and fixtures apply
unchanged; only the server behind it is AG2's.
"""

from __future__ import annotations

from typing import Any

from ag2 import Agent
from ag2.config.openai import OpenAIResponsesConfig
from ag2.mcp import MCPApp, MCPServer
from mcp.types import CallToolResult, TextContent

DIAGRAM_URI = "ui://ag2/diagram"

DIAGRAM_HTML = """\
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #fff; font-family: system-ui, sans-serif; }
  #empty { color: #888; padding: 24px; text-align: center; }
  svg { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
<div id="empty">Waiting for diagram…</div>
<div id="root"></div>
<script>
  var NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) { n.setAttribute(k, attrs[k]); }
    if (text !== undefined) { n.textContent = text; }
    return n;
  }
  function style(e) {
    return {
      stroke: e.strokeColor || "#1e1e1e",
      fill: e.backgroundColor && e.backgroundColor !== "transparent" ? e.backgroundColor : "none",
      "stroke-width": 2
    };
  }
  function label(svg, e, cx, cy) {
    var l = e.label && e.label.text;
    if (!l) { return; }
    svg.appendChild(el("text", {
      x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "middle",
      "font-size": e.label.fontSize || 16, fill: "#1e1e1e"
    }, l));
  }
  function render(elements) {
    var camera = { x: 0, y: 0, width: 800, height: 600 };
    var svg = el("svg", {});
    elements.forEach(function (e) {
      var w = e.width || 160, h = e.height || 70, x = e.x || 0, y = e.y || 0;
      if (e.type === "cameraUpdate") {
        camera = { x: x, y: y, width: e.width || 800, height: e.height || 600 };
      } else if (e.type === "rectangle") {
        svg.appendChild(el("rect", Object.assign({ x: x, y: y, width: w, height: h, rx: 8 }, style(e))));
        label(svg, e, x + w / 2, y + h / 2);
      } else if (e.type === "ellipse") {
        svg.appendChild(el("ellipse", Object.assign({ cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }, style(e))));
        label(svg, e, x + w / 2, y + h / 2);
      } else if (e.type === "diamond") {
        var pts = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]].join(" ");
        svg.appendChild(el("polygon", Object.assign({ points: pts }, style(e))));
        label(svg, e, x + w / 2, y + h / 2);
      } else if (e.type === "arrow" || e.type === "line") {
        var x2 = e.endX !== undefined ? e.endX : x + (e.width || 0);
        var y2 = e.endY !== undefined ? e.endY : y + (e.height || 0);
        svg.appendChild(el("line", { x1: x, y1: y, x2: x2, y2: y2, stroke: "#1e1e1e", "stroke-width": 2,
          "marker-end": e.type === "arrow" ? "url(#head)" : "" }));
      } else if (e.type === "text") {
        svg.appendChild(el("text", { x: x, y: y, "font-size": e.fontSize || 20, fill: "#1e1e1e" }, e.text || ""));
      }
    });
    var defs = el("defs", {});
    var marker = el("marker", { id: "head", markerWidth: 10, markerHeight: 8, refX: 9, refY: 4, orient: "auto" });
    marker.appendChild(el("polygon", { points: "0 0, 10 4, 0 8", fill: "#1e1e1e" }));
    defs.appendChild(marker);
    svg.insertBefore(defs, svg.firstChild);
    svg.setAttribute("viewBox", [camera.x, camera.y, camera.width, camera.height].join(" "));
    document.getElementById("empty").remove();
    document.getElementById("root").replaceChildren(svg);
  }
  ag2ui.onToolResult(function (result) {
    var data = result && result.structuredContent;
    if (data && Array.isArray(data.elements)) { render(data.elements); }
  });
</script>
</body>
</html>
"""

diagram_app = MCPApp(
    DIAGRAM_URI,
    DIAGRAM_HTML,
    title="Diagram",
    description="Draws simple diagrams (shapes, arrows, text) from a list of elements.",
)


@diagram_app.tool
async def create_view(elements: list[dict[str, Any]]) -> CallToolResult:
    """Draw a diagram.

    `elements` is a list of shapes. Supported types: `rectangle`, `ellipse`,
    `diamond` (x, y, width, height, optional `label: {text, fontSize}`), `arrow`
    (x, y, endX, endY), `text` (x, y, text, fontSize), and an optional trailing
    `cameraUpdate` (x, y, width, height) that frames the whole diagram.
    """
    return CallToolResult(
        content=[TextContent(type="text", text=f"Rendered a diagram with {len(elements)} elements.")],
        structuredContent={"elements": elements},
    )


# MCPServer wraps an Agent and exposes it as a conversational `ask` tool next to
# the app's tools. AG2 1.1.2 always registers it and the runtime's `mcpApps`
# config has no per-server tool filter, so `ask` reaches the chat agent's tool
# list; agents/mcp_apps_agent.py's prompt tells the model not to call it, and
# the demo has no fixture for it. The chat agent calls `create_view` directly.
_helper_agent = Agent(
    "mcp_apps_server",
    prompt="You draw simple diagrams.",
    config=OpenAIResponsesConfig(model="gpt-5-mini"),
)

mcp_apps_server = MCPServer(_helper_agent, apps=[diagram_app], path="/mcp")
