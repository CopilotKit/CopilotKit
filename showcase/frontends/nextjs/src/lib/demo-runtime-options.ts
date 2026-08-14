/**
 * Per-demo CopilotRuntime option DEFAULTS that are identical across every
 * integration that ships the demo.
 *
 * READ THIS BEFORE EDITING A VALUE HERE: THE MANIFESTS ARE AUTHORITATIVE, AND
 * EDITING THIS FILE CHANGES NOTHING FOR ANY SHIPPED INTEGRATION.
 *
 * All 20 manifests declare a byte-identical `demos[].runtime` block for all four
 * ids this module covers (`mcp-apps`, `headless-complete`, `open-gen-ui`,
 * `open-gen-ui-advanced`), and `mergeRuntimeOptions` lets the manifest win at
 * every level it reaches. So `EXCALIDRAW_MCP_APPS` and `OPEN_GEN_UI` are
 * OVERWRITTEN on every real request: change the Excalidraw URL here and no cell
 * moves. To change a shipped value, edit
 * `showcase/integrations/<slug>/manifest.yaml` — all 20 of them.
 *
 * WHY THE TABLE SURVIVES ANYWAY: it is the value a demo gets when a manifest
 * declares no `runtime` block at all. That is not hypothetical — it is what a
 * NEW integration gets before anyone writes the block, and it is asserted
 * ("supplies the shared open-gen-ui default even when a manifest omits it" in
 * agent-resolution.test.ts). Deleting the entries would make a new integration's
 * `open-gen-ui` cell silently scope to nothing.
 *
 * So there is one owner per question: the manifests own what SHIPS, this table
 * owns what a manifest that says NOTHING falls back to. Do not add an entry
 * here expecting it to change a live cell.
 *
 * Scope rule (read before adding an entry): a default here is applied to
 * EVERY integration serving that demo id. So it may only hold a value that
 * every integration wants. Anything that differs per integration — and
 * anything an integration deliberately OMITS — belongs in that
 * integration's `manifest.yaml` under `demos[].runtime`, never here.
 *
 * Deliberately ABSENT, even though they look tempting:
 *
 * - `declarative-gen-ui` -> `a2ui`. All 20 manifests list the id under
 *   `features` and ship a `demos[]` row, but they split three ways on the
 *   `runtime` block (counted from the manifests on 2026-08-11):
 *     - 14 declare `runtime.a2ui` with `defaultCatalogId:
 *       declarative-gen-ui-catalog`. Ten of those also set
 *       `injectA2UITool: false` (agno, built-in-agent, claude-sdk-python,
 *       claude-sdk-typescript, mastra, ms-agent-dotnet,
 *       ms-agent-harness-dotnet, ms-agent-python, pydantic-ai, spring-ai),
 *       three leave it unset (ag2, crewai-crews, langroid), and llamaindex
 *       sets it to `true`.
 *     - 6 declare NO `runtime` block at all, on purpose: google-adk,
 *       langgraph-fastapi, langgraph-python, langgraph-typescript, strands,
 *       strands-typescript.
 *   The shared page (`demos/declarative-gen-ui/page.tsx`) always passes the
 *   catalog through `<CopilotKit a2ui={{ catalog: myCatalog }}>`, which
 *   auto-enables A2UI and defaults tool injection ON. A default here would
 *   flip `injectA2UITool` to false for those SIX and kill the render.
 *   (`injectA2UITool` also splits 10 / 3 / 1 among the manifests that DO
 *   declare the block, so there is no one value to default to anyway.)
 * - `a2ui-fixed-schema` -> `a2ui.injectA2UITool: false`. spring-ai
 *   deliberately declares no runtime `a2ui` for that demo, and llamaindex
 *   wants `true`.
 * - `beautiful-chat` -> `a2ui` / `openGenerativeUI`. `injectA2UITool` splits
 *   (true for langgraph-python / langgraph-typescript / llamaindex /
 *   built-in-agent, false everywhere else) and ag2 needs
 *   `openGenerativeUI: { agents: ["beautiful-chat"] }` rather than `true`.
 *
 * Every value is passed through the `${VAR}` / `${VAR:-default}`
 * interpolator before it reaches CopilotRuntime, so shell-style placeholders
 * are legal here exactly as they are in the manifests.
 */

export type RuntimeOptions = Record<string, unknown>;

/**
 * Freeze a value and everything under it.
 *
 * Every constant below is shared by TWO demo ids, and `mergeRuntimeOptions`
 * copies one level only — a merged `mcpApps` group is the SAME object this
 * module exports. One in-place edit anywhere downstream would therefore
 * change what a second demo, in a second request, is served. Freezing turns
 * that into a throw (a TypeError in strict mode, which every module here is)
 * at the line that does it, instead of a wrong render somewhere else.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/**
 * The Excalidraw MCP server every MCP-Apps demo dials. Verbatim-identical in
 * all 20 manifests — which is why it is a legible default here, and also why
 * editing it has NO effect: every manifest overrides it. See the module
 * docstring.
 */
const EXCALIDRAW_MCP_APPS: RuntimeOptions = deepFreeze({
  mcpApps: {
    servers: [
      {
        type: "http",
        url: "${MCP_SERVER_URL:-https://mcp.excalidraw.com}",
        serverId: "excalidraw",
      },
    ],
  },
});

/**
 * Open Generative UI is scoped to the two OGUI agents. Both demos share one
 * list because either page can address either agent.
 */
const OPEN_GEN_UI: RuntimeOptions = deepFreeze({
  openGenerativeUI: { agents: ["open-gen-ui", "open-gen-ui-advanced"] },
});

export const DEMO_RUNTIME_OPTIONS: Readonly<Record<string, RuntimeOptions>> =
  Object.freeze({
    "mcp-apps": EXCALIDRAW_MCP_APPS,
    "headless-complete": EXCALIDRAW_MCP_APPS,
    "open-gen-ui": OPEN_GEN_UI,
    "open-gen-ui-advanced": OPEN_GEN_UI,
  });
