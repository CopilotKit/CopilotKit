#!/usr/bin/env node
/**
 * Static check: no documented code block teaches an import of a symbol our own
 * packages mark `@deprecated`.
 *
 * WHY THIS EXISTS (PE-115)
 * ------------------------
 * A retired class (`LangGraphHttpAgent`) sat in the LangGraph quickstart until
 * an onboarding run tripped over it, and then on six further pages until
 * someone went looking. Nothing in the build would ever have said so. Two
 * obvious gates were considered and ruled out, each for a measured reason:
 *
 *   NOT COMPILATION.  PE-108 recorded a control: the pre-fix code compiled
 *   clean against the exact pins in the page's sidecar. A deprecated symbol is
 *   still a valid symbol — `@deprecated` is a JSDoc tag that editors render as
 *   a strike-through and `tsc` ignores entirely, at any strictness. Re-verified
 *   for this change: a file importing a `@deprecated` export compiles with exit
 *   code 0 under `--strict --noUnusedLocals --exactOptionalPropertyTypes`.
 *
 *   NOT MORE `doctest` TAGS.  Of PE-108's six blocks only one could carry a
 *   tag. Two would hit the extractor's same-fence-title concatenation trap
 *   (`scripts/doc-tests/extract.ts` joins every block sharing a title within a
 *   page into one file, so a second `const runtime` becomes TS2451), and three
 *   are elided or partial troubleshooting fragments that are not compilable
 *   units at all. Most documented code is, correctly, not compilable in
 *   isolation, so a gate built on compilation will never see it.
 *
 * So this check is textual, not semantic: it reads import specifiers out of
 * fenced code blocks and compares them against a set of deprecated symbols it
 * derives from the packages. Partial fragments are covered because nothing has
 * to parse or resolve.
 *
 * THE DEPRECATED SET IS DERIVED, NOT LISTED
 * -----------------------------------------
 * `deprecatedExportIndex()` walks every `packages/*` public entrypoint in the
 * package's own `exports` map, loads its TypeScript source, and keeps the
 * exports whose symbol carries a `@deprecated` JSDoc tag. It keys on the
 * presence of the TAG, never on the human-readable message text — PE-114 just
 * rewrote that text, and a check that matched on wording would have gone blind
 * the day it landed. It covers the v2 surface too: `createCopilotEndpoint` and
 * friends on `@copilotkit/runtime/v2` are deprecated in favour of
 * `createCopilotRuntimeHandler`, and this check sees them for free.
 *
 * WHAT COUNTS AS A HIT
 * --------------------
 * A (module specifier, imported name) PAIR. Keying on the bare name would flag
 * any unrelated `CopilotKit` or `Thread`; keying on the module alone would flag
 * every legitimate v1 import path. Both halves have to match.
 *
 * ALLOWLIST
 * ---------
 * Some pages document a deprecation ON PURPOSE — the v1 export map has to keep
 * naming `LangGraphHttpAgent`, because naming it IS the page's job. Those are
 * listed individually in ALLOWLIST below by (file, rule, subject) with the
 * ticket that owns each, following `scripts/validate-starter-deps.mjs`. A
 * blanket directory exclusion would also hide a NEW mistake made on the same
 * page, so the exemptions are per-symbol.
 *
 * The list only ever shrinks. A stale entry — one that no longer matches a real
 * hit — is itself a failure, so fixing a page forces its line out.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Both surfaces that teach CopilotKit code. `skills/` is the bundled agent
// skill copy of the same guidance; it is clean today (16 files, 9 TypeScript
// blocks, 4 `@copilotkit` imports, none deprecated — measured, not assumed) and
// is scanned so it stays that way.
const DOC_ROOTS = ["showcase/shell-docs/src/content", "skills"];
const PACKAGES_DIR = path.join(repoRoot, "packages");

const RULE = "deprecated-import";

const CONTENT_PREFIX = "showcase/shell-docs/src/content/";

// Pages whose JOB is to name a deprecated symbol: the v1 reference, and the
// migration pages that show the v1 "before" next to the v2 "after". These are
// listed per symbol rather than by directory on purpose — excluding
// `reference/v1/` wholesale would also hide a NEW mistake made on one of those
// pages. `reference/v1/export-map.mdx` is not here because it names its symbols
// in inline code spans and table cells rather than in a fenced code block, so
// the scan never sees it; that was verified, not assumed.
const INTENTIONAL_V1_PAGES = {
  "docs/migrate/v2.mdx": [
    "@copilotkit/react-core:CopilotKit",
    "@copilotkit/react-core:useCopilotAction",
    "@copilotkit/react-core:useCopilotReadable",
    "@copilotkit/react-ui:CopilotChat",
    "@copilotkit/react-ui:CopilotPopup",
    "@copilotkit/react-ui:CopilotSidebar",
    "@copilotkit/runtime:CopilotRuntime",
  ],
  "reference/v1/classes/CopilotRuntime.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
  ],
  "reference/v1/classes/CopilotTask.mdx": [
    "@copilotkit/react-core:CopilotTask",
    "@copilotkit/react-core:useCopilotContext",
  ],
  "reference/v1/classes/llm-adapters/AnthropicAdapter.mdx": [
    "@copilotkit/runtime:AnthropicAdapter",
    "@copilotkit/runtime:CopilotRuntime",
  ],
  "reference/v1/classes/llm-adapters/GoogleGenerativeAIAdapter.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:GoogleGenerativeAIAdapter",
  ],
  "reference/v1/classes/llm-adapters/GroqAdapter.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:GroqAdapter",
  ],
  "reference/v1/classes/llm-adapters/LangChainAdapter.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:LangChainAdapter",
  ],
  "reference/v1/classes/llm-adapters/OpenAIAdapter.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:OpenAIAdapter",
  ],
  "reference/v1/classes/llm-adapters/OpenAIAssistantAdapter.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:OpenAIAssistantAdapter",
  ],
  "reference/v1/components/chat/CopilotChat.mdx": [
    "@copilotkit/react-ui:CopilotChat",
  ],
  "reference/v1/components/chat/CopilotPopup.mdx": [
    "@copilotkit/react-ui:CopilotPopup",
  ],
  "reference/v1/components/chat/CopilotSidebar.mdx": [
    "@copilotkit/react-ui:CopilotSidebar",
  ],
  "reference/v1/components/CopilotKit.mdx": [
    "@copilotkit/react-core:CopilotKit",
  ],
  "reference/v1/components/CopilotTextarea.mdx": [
    "@copilotkit/react-textarea:CopilotTextarea",
  ],
  "reference/v1/hooks/useCoAgent.mdx": ["@copilotkit/react-core:useCoAgent"],
  "reference/v1/hooks/useCoAgentStateRender.mdx": [
    "@copilotkit/react-core:useCoAgentStateRender",
  ],
  "reference/v1/hooks/useCopilotAdditionalInstructions.mdx": [
    "@copilotkit/react-core:useCopilotAdditionalInstructions",
  ],
  "reference/v1/hooks/useCopilotChatHeadless_c.mdx": [
    "@copilotkit/react-core:CopilotKit",
    "@copilotkit/react-core:useCopilotChatHeadless_c",
    "@copilotkit/react-core:useCopilotChatSuggestions",
  ],
  "reference/v1/hooks/useCopilotChatSuggestions.mdx": [
    "@copilotkit/react-ui:useCopilotChatSuggestions",
  ],
  "reference/v1/hooks/useCopilotReadable.mdx": [
    "@copilotkit/react-core:useCopilotReadable",
  ],
  "reference/v1/hooks/useDefaultTool.mdx": [
    "@copilotkit/react-core:useDefaultTool",
  ],
  "reference/v1/hooks/useFrontendTool.mdx": [
    "@copilotkit/react-core:useFrontendTool",
  ],
  "reference/v1/hooks/useHumanInTheLoop.mdx": [
    "@copilotkit/react-core:useHumanInTheLoop",
  ],
  "reference/v1/hooks/useLangGraphInterrupt.mdx": [
    "@copilotkit/react-core:useLangGraphInterrupt",
  ],
  "reference/v1/hooks/useRenderToolCall.mdx": [
    "@copilotkit/react-core:useRenderToolCall",
  ],
  "snippets/shared/troubleshooting/migrate-to-1.10.X.mdx": [
    "@copilotkit/react-ui:AssistantMessageProps",
  ],
  "snippets/shared/troubleshooting/migrate-to-v2.mdx": [
    "@copilotkit/react-core:CopilotKit",
    "@copilotkit/react-core:useCopilotAction",
    "@copilotkit/react-core:useCopilotReadable",
    "@copilotkit/react-ui:CopilotChat",
    "@copilotkit/react-ui:CopilotPopup",
    "@copilotkit/react-ui:CopilotSidebar",
  ],
};

// Live pages — quickstarts, guides and snippets — that still teach a symbol the
// packages mark deprecated. This is pre-existing debt measured on 2026-09-17
// when the check landed, NOT a decision that the guidance is fine. Some of
// these have a named v2 replacement and are a straightforward docs edit; others
// (`LangGraphAgent`, `copilotRuntimeNestEndpoint`) have no 1:1 v2 replacement
// at all, so the page cannot be fixed until the product grows one. See the
// PE-115 pull request for the full per-page triage.
//
// This list only ever shrinks. Do not add to it to make a new page pass.
const LIVE_PAGE_DEBT = {
  "docs/agentic-protocols/ag-ui-middleware.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "docs/custom-look-and-feel/css.mdx": [
    "@copilotkit/react-ui:CopilotKitCSSProperties",
  ],
  "docs/deepagents/index.mdx": ["@copilotkit/runtime/langgraph:LangGraphAgent"],
  "docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-3-copilot-textarea.mdx":
    ["@copilotkit/react-textarea:CopilotTextarea"],
  "docs/integrations/deepagents/frontend-tools.mdx": [
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
  ],
  "docs/integrations/deepagents/generative-ui/mcp-apps.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "docs/integrations/deepagents/generative-ui/state-rendering.mdx": [
    "@copilotkit/sdk-js/langgraph-middlewares:stateItem",
    "@copilotkit/sdk-js/langgraph-middlewares:stateStreamingMiddleware",
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:zodState",
  ],
  "docs/integrations/deepagents/generative-ui/your-components/interrupt-based.mdx":
    [
      "@copilotkit/sdk-js/langgraph:createCopilotkitMiddleware",
      "@copilotkit/sdk-js/langgraph:zodState",
    ],
  "docs/integrations/deepagents/human-in-the-loop/interrupt-flow.mdx": [
    "@copilotkit/sdk-js/langgraph:createCopilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:zodState",
  ],
  "docs/integrations/deepagents/quickstart.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
  ],
  "docs/integrations/deepagents/shared-state/in-app-agent-read.mdx": [
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:zodState",
  ],
  "docs/integrations/deepagents/shared-state/in-app-agent-write.mdx": [
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:zodState",
  ],
  "docs/integrations/deepagents/shared-state/predictive-state-updates.mdx": [
    "@copilotkit/sdk-js/langgraph-middlewares:stateItem",
    "@copilotkit/sdk-js/langgraph-middlewares:stateStreamingMiddleware",
    "@copilotkit/sdk-js/langgraph:copilotkitCustomizeConfig",
    "@copilotkit/sdk-js/langgraph:copilotkitEmitState",
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:CopilotKitStateAnnotation",
    "@copilotkit/sdk-js/langgraph:zodState",
  ],
  "docs/integrations/langgraph/agent-app-context.mdx": [
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/langgraph/deep-agents.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "docs/integrations/langgraph/generative-ui/your-components/display-only.mdx":
    ["@copilotkit/sdk-js/langgraph:CopilotKitStateSchema"],
  "docs/integrations/langgraph/generative-ui/your-components/interactive.mdx": [
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/langgraph/generative-ui/your-components/interrupt-based.mdx":
    ["@copilotkit/sdk-js/langgraph:CopilotKitStateSchema"],
  "docs/integrations/langgraph/human-in-the-loop/interrupt-flow.mdx": [
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/langgraph/quickstart.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "docs/integrations/langgraph/shared-state/in-app-agent-read.mdx": [
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/langgraph/shared-state/in-app-agent-write.mdx": [
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/langgraph/shared-state/predictive-state-updates.mdx": [
    "@copilotkit/sdk-js/langgraph-middlewares:stateItem",
    "@copilotkit/sdk-js/langgraph-middlewares:stateStreamingMiddleware",
    "@copilotkit/sdk-js/langgraph:convertActionsToDynamicStructuredTools",
    "@copilotkit/sdk-js/langgraph:copilotkitCustomizeConfig",
    "@copilotkit/sdk-js/langgraph:copilotkitEmitState",
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
    "@copilotkit/sdk-js/langgraph:CopilotKitStateAnnotation",
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/langgraph/shared-state/state-inputs-outputs.mdx": [
    "@copilotkit/sdk-js/langgraph:CopilotKitStateAnnotation",
  ],
  "docs/integrations/langgraph/shared-state/workflow-execution.mdx": [
    "@copilotkit/sdk-js/langgraph:CopilotKitStateSchema",
  ],
  "docs/integrations/llamaindex/shared-state/predictive-state-updates.mdx": [
    "@copilotkit/react-ui:CopilotSidebar",
  ],
  "docs/integrations/microsoft-agent-framework/generative-ui/a2ui/index.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
  ],
  "snippets/integrations/langgraph/frontend-tools.mdx": [
    "@copilotkit/sdk-js/langgraph:copilotkitMiddleware",
  ],
  "snippets/integrations/langsmith/index.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "snippets/self-hosting-copilot-runtime-create-endpoint.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:copilotRuntimeNestEndpoint",
    "@copilotkit/runtime:copilotRuntimeNextJSAppRouterEndpoint",
    "@copilotkit/runtime:copilotRuntimeNextJSPagesRouterEndpoint",
    "@copilotkit/runtime:copilotRuntimeNodeHttpEndpoint",
  ],
  "snippets/self-hosting-copilot-runtime-starter.mdx": [
    "@copilotkit/runtime:CopilotRuntime",
    "@copilotkit/runtime:copilotRuntimeNestEndpoint",
    "@copilotkit/runtime:copilotRuntimeNextJSPagesRouterEndpoint",
    "@copilotkit/runtime:copilotRuntimeNodeHttpEndpoint",
    "@copilotkit/runtime:ExperimentalEmptyAdapter",
  ],
  "snippets/self-hosting-remote-endpoints.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "snippets/setup/deepagents/channels-agent-setup.mdx": [
    "@copilotkit/runtime/langgraph:LangGraphAgent",
  ],
  "snippets/shared/guides/custom-look-and-feel/bring-your-own-components.mdx": [
    "@copilotkit/react-core:CopilotKit",
    "@copilotkit/react-core:useCoAgentStateRender",
    "@copilotkit/react-core:useFrontendTool",
    "@copilotkit/react-ui:AssistantMessageProps",
    "@copilotkit/react-ui:ButtonProps",
    "@copilotkit/react-ui:CopilotChatSuggestion",
    "@copilotkit/react-ui:CopilotSidebar",
    "@copilotkit/react-ui:HeaderProps",
    "@copilotkit/react-ui:InputProps",
    "@copilotkit/react-ui:Markdown",
    "@copilotkit/react-ui:MessagesProps",
    "@copilotkit/react-ui:RenderSuggestion",
    "@copilotkit/react-ui:RenderSuggestionsListProps",
    "@copilotkit/react-ui:useChatContext",
    "@copilotkit/react-ui:UserMessageProps",
    "@copilotkit/react-ui:WindowProps",
  ],
  "snippets/shared/guides/custom-look-and-feel/customize-built-in-ui-components.mdx":
    ["@copilotkit/react-ui:CopilotKitCSSProperties"],
  "snippets/shared/intelligence/headless-ui.mdx": [
    "@copilotkit/react-core:useCopilotChatHeadless_c",
    "@copilotkit/react-core:useCopilotChatSuggestions",
  ],
};

function expand(group, ticket) {
  return Object.entries(group).flatMap(([file, subjects]) =>
    subjects.map((subject) => ({
      file: `${CONTENT_PREFIX}${file}`,
      rule: RULE,
      subject,
      ticket,
    })),
  );
}

/**
 * Exemptions, each pinned to an exact (file, rule, symbol) triple so a
 * different mistake on the same page still fails. A stale entry is itself a
 * failure, so fixing a page forces its line out.
 */
export const ALLOWLIST = [
  ...expand(
    INTENTIONAL_V1_PAGES,
    "PE-115 (page documents a v1 API deliberately)",
  ),
  ...expand(
    LIVE_PAGE_DEBT,
    "PE-115 follow-up (live page still teaches a deprecated symbol)",
  ),
];

function isAllowed(hit) {
  return ALLOWLIST.find(
    (a) =>
      a.file === hit.file && a.rule === hit.rule && a.subject === hit.subject,
  );
}

// ---------------------------------------------------------------------------
// The deprecated set, derived from the packages
// ---------------------------------------------------------------------------

/**
 * Map every published entrypoint of every `packages/*` package to the
 * TypeScript source behind it. The `exports` map points at built `dist` files,
 * which do not exist in a fresh clone, so the dist path is rewritten to its
 * `src` twin. Returns `{ importPath, src }`, plus any entrypoint that could not
 * be resolved so callers can refuse to report a silently-shrunken index.
 */
export function packageEntrypoints(packagesDir = PACKAGES_DIR) {
  const resolved = [];
  const unresolved = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const manifestPath = path.join(packagesDir, name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.name || !manifest.exports) continue;
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (subpath.endsWith(".json") || subpath.endsWith(".css")) continue;
      const dist =
        typeof target === "string"
          ? target
          : (target.import ?? target.default ?? target.require);
      if (typeof dist !== "string") continue;
      const importPath =
        subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
      const stem = dist
        .replace(/^\.\//, "")
        .replace(/^dist\//, "src/")
        .replace(/\.(m|c)?js$/, "");
      const candidates = [
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}/index.ts`,
        `${stem}/index.tsx`,
        // Angular ships a flat fesm bundle whose name has no `src` twin.
        "src/public-api.ts",
        "src/index.ts",
      ];
      const src = candidates
        .map((candidate) => path.join(packagesDir, name, candidate))
        .find(
          (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
        );
      if (src) resolved.push({ importPath, src });
      else unresolved.push({ importPath, dist });
    }
  }
  return { resolved, unresolved };
}

/**
 * `Map<importPath, Set<exportName>>` of everything the packages mark
 * `@deprecated`, keyed on the tag rather than its message text.
 */
export function deprecatedExportIndex(packagesDir = PACKAGES_DIR) {
  const { resolved, unresolved } = packageEntrypoints(packagesDir);
  const program = ts.createProgram(
    resolved.map(({ src }) => src),
    {
      allowArbitraryExtensions: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
  );
  const checker = program.getTypeChecker();
  const index = new Map();
  const unloaded = [];
  for (const { importPath, src } of resolved) {
    const sourceFile = program.getSourceFile(src);
    if (!sourceFile?.symbol) {
      unloaded.push({ importPath, src });
      continue;
    }
    for (const symbol of checker.getExportsOfModule(sourceFile.symbol)) {
      if (
        !symbol.getJsDocTags(checker).some((tag) => tag.name === "deprecated")
      )
        continue;
      if (!index.has(importPath)) index.set(importPath, new Set());
      index.get(importPath).add(symbol.name);
    }
  }
  return { index, unresolved, unloaded, entrypointCount: resolved.length };
}

// ---------------------------------------------------------------------------
// Reading import specifiers out of documented code
// ---------------------------------------------------------------------------

const CODE_LANGS = new Set([
  "ts",
  "tsx",
  "typescript",
  "js",
  "jsx",
  "javascript",
]);

/**
 * Fenced code blocks in an MDX/Markdown document, with the line each starts on.
 * Deliberately a scanner rather than an MDX parse: a partial fragment inside a
 * `<Tabs>` is still a fence, and this must not depend on the document parsing.
 */
export function codeBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i]
      .trimStart()
      .match(/^(`{3,})\s*([A-Za-z0-9+-]*)(.*)$/);
    if (!open && fence) {
      open = {
        marker: fence[1],
        lang: fence[2].toLowerCase(),
        line: i + 1,
        body: [],
      };
      continue;
    }
    if (open && new RegExp(`^${open.marker}\\s*$`).test(lines[i].trimStart())) {
      blocks.push({
        lang: open.lang,
        line: open.line,
        code: open.body.join("\n"),
      });
      open = null;
      continue;
    }
    if (open) open.body.push(lines[i]);
  }
  return blocks;
}

const IMPORT_RE = /\bimport\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
const REQUIRE_RE =
  /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;

/**
 * The names a clause binds, resolved back to the names the MODULE exports:
 * `{ A as B }` binds B locally but imports A, and it is A that may be
 * deprecated. A default or namespace binding imports no named export, so it
 * contributes nothing.
 */
function importedNames(clause) {
  const names = [];
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (!braces) return names;
  for (const part of braces[1].split(",")) {
    const cleaned = part.replace(/\btype\s+/g, "").trim();
    if (!cleaned) continue;
    const source = cleaned.split(/\s+as\s+/)[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(source)) names.push(source);
  }
  return names;
}

/**
 * Every (module specifier, imported name) pair a block teaches.
 */
export function importPairs(code) {
  const pairs = [];
  for (const match of code.matchAll(IMPORT_RE)) {
    for (const name of importedNames(match[2])) {
      pairs.push({ module: match[3], name });
    }
  }
  for (const match of code.matchAll(REQUIRE_RE)) {
    for (const name of importedNames(match[1])) {
      pairs.push({ module: match[2], name });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function findMdxFiles(dir) {
  const results = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md"))
        results.push(full);
    }
  };
  walk(dir);
  return results.sort();
}

export function scanDocs(index, roots = DOC_ROOTS) {
  const hits = [];
  const files = (Array.isArray(roots) ? roots : [roots]).flatMap((root) =>
    findMdxFiles(path.isAbsolute(root) ? root : path.join(repoRoot, root)),
  );
  for (const file of files) {
    const relative = path.relative(repoRoot, file).split(path.sep).join("/");
    const text = readFileSync(file, "utf8");
    for (const block of codeBlocks(text)) {
      if (!CODE_LANGS.has(block.lang)) continue;
      for (const { module, name } of importPairs(block.code)) {
        if (!index.get(module)?.has(name)) continue;
        hits.push({
          file: relative,
          rule: RULE,
          subject: `${module}:${name}`,
          line: block.line,
          detail: `code block imports \`${name}\` from \`${module}\`, which the package marks @deprecated`,
          fix: `Use the v2 replacement named in the symbol's @deprecated tooltip, or see showcase/shell-docs/src/content/reference/v1/export-map.mdx`,
        });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main() {
  const { index, unresolved, unloaded, entrypointCount } =
    deprecatedExportIndex();

  // The index shrinking silently is the one failure mode that would make this
  // check quietly useless, so an entrypoint we cannot read is an error rather
  // than a skip.
  if (unresolved.length > 0 || unloaded.length > 0) {
    console.error(
      "::error::scripts/validate-doc-deprecated-imports.mjs could not read every package entrypoint, so the deprecated set is incomplete:",
    );
    for (const entry of unresolved)
      console.error(`  - unresolved: ${entry.importPath} (${entry.dist})`);
    for (const entry of unloaded)
      console.error(`  - unloaded: ${entry.importPath} (${entry.src})`);
    return 1;
  }

  const pairCount = [...index.values()].reduce((sum, set) => sum + set.size, 0);
  const hits = scanDocs(index);

  const failures = [];
  const allowed = [];
  for (const hit of hits) {
    const entry = isAllowed(hit);
    if (entry) allowed.push({ ...hit, ticket: entry.ticket });
    else failures.push(hit);
  }

  if (allowed.length > 0) {
    console.log(
      `Intentionally documented deprecations (${allowed.length}, allowlisted):`,
    );
    for (const hit of allowed)
      console.log(
        `  - ${hit.file}:${hit.line} ${hit.subject} -> ${hit.ticket}`,
      );
    console.log("");
  }

  // The allowlist must only ever shrink.
  const stale = ALLOWLIST.filter(
    (a) =>
      !hits.some(
        (hit) =>
          hit.file === a.file &&
          hit.rule === a.rule &&
          hit.subject === a.subject,
      ),
  );
  if (stale.length > 0) {
    console.error(
      "::error::scripts/validate-doc-deprecated-imports.mjs has stale allowlist entries — the page was fixed, so delete them:",
    );
    for (const a of stale)
      console.error(`  - ${a.file}: ${a.rule} "${a.subject}"`);
    return 1;
  }

  if (failures.length === 0) {
    console.log(
      `Documented imports OK — no code block imports any of the ${pairCount} deprecated symbols across ${entrypointCount} package entrypoints.`,
    );
    return 0;
  }

  console.error("");
  console.error("Documented deprecated-import check FAILED.");
  console.error("");
  for (const hit of failures) {
    console.error(`::error file=${hit.file},line=${hit.line}::${hit.detail}`);
    console.error(`  file:    ${hit.file}:${hit.line}`);
    console.error(`  rule:    ${hit.rule} (${hit.subject})`);
    console.error(`  problem: ${hit.detail}`);
    console.error(`  fix:     ${hit.fix}`);
    console.error("");
  }
  console.error(
    "See scripts/validate-doc-deprecated-imports.mjs for why this is textual rather than a compile step (PE-108, PE-115).",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
