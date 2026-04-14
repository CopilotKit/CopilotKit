# Open GenUI Renderer

The Open GenUI renderer is the most unconstrained rendering approach. The agent
generates complete HTML, CSS, and JavaScript on the fly, which is rendered inside
CopilotKit's sandboxed iframe. There are no predefined components or schemas --
the agent has full creative freedom to produce any visual output it needs.

## How it works

1. `CopilotKitProvider` is configured with `openGenerativeUI={{}}`, which enables
   the sandboxed iframe rendering pipeline.
2. The agent receives a `generateSandboxedUi` tool that accepts HTML, CSS, and
   JavaScript parameters.
3. Generated content streams into an isolated iframe -- styles apply first, then
   HTML streams progressively, and finally JavaScript expressions execute.
4. CDN libraries (Chart.js, D3, Three.js, etc.) can be loaded via `<script>` tags
   in the generated HTML.
5. `CopilotSidebar` hosts the chat interface where the sandboxed output appears
   inline as a message attachment.

## When to use

Use this renderer when you want maximum flexibility and the agent needs to produce
arbitrary, creative UI without being limited to a fixed component catalog. The
sandbox ensures security isolation so generated code cannot access the host
application. This is ideal for dashboards, data visualizations, interactive tools,
and any scenario where the output shape is not known ahead of time.
