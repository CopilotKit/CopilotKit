import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Regression guard for the D4 chat probe's `domDone` turn-completion gate.
//
// ROOT the probe depends on: `d4-chat-roundtrip.ts` gates turn completion on
// `domDone` — derived from the DOM `data-copilot-running` attribute on the
// `[data-testid="copilot-chat"]` container. That attribute is emitted ONLY by
// the attribute-bearing render branches of `CopilotChatView`, which fire when
// `<CopilotChat/>` is used in its SELF-CLOSING form. The OTHER branch —
// `if (children)` (the render-prop / slot form `<CopilotChat>{...}</CopilotChat>`)
// — returns a bare `<div style="display:contents">` that emits NEITHER
// `data-testid="copilot-chat"` NOR `data-copilot-running`. See
// packages/react-core/src/v2/components/chat/CopilotChatView.tsx (the
// `if (children)` early-return vs the two self-closing returns).
//
// If a PROBED-route page were to switch to the render-prop form (or drop
// `<CopilotChat/>` entirely for a custom chat UI), `domDone` could never fire
// for that cell: the probe would silently fall back to the wider ~60s /
// double-send polling path instead of the fast DOM-coalesced completion. That
// regression is INVISIBLE to the probe's own unit tests (they inject fakes) and
// would only surface as a slow, flappy live cell. This test fails at CI time if
// any probed-route page stops using the attribute-bearing self-closing form.
//
// We assert at the SOURCE level (AST) rather than by rendering the pages: the
// pages are Next.js `"use client"` app-router entrypoints that mount a live
// `<CopilotKit runtimeUrl=.../>` provider and framework agents, so a faithful
// full render would need the whole runtime + agent stack stood up — impractical
// and slow for a structural guard. Parsing the TSX with the TypeScript compiler
// (not a hand-rolled regex/lexer) distinguishes the self-closing element from
// the children form robustly, matching the exact `CopilotChatView` branch split.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// drivers → probes → src → harness → showcase → repo root
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../../..");
const INTEGRATIONS_DIR = path.resolve(WORKSPACE_ROOT, "showcase/integrations");

// The routes the D4 chat probe navigates to (see `demoPath` in
// d4-chat-roundtrip.ts): `/demos/agentic-chat` ALWAYS; `/demos/tool-rendering`
// only where the slug's registry exposes it. We scan the corresponding page
// entrypoints for every integration that HAS them.
const PROBED_ROUTES = ["agentic-chat", "tool-rendering"] as const;

const COPILOT_CHAT_TAG = "CopilotChat";

interface ProbedPage {
  slug: string;
  route: string;
  file: string;
}

function listIntegrationSlugs(): string[] {
  return readdirSync(INTEGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

function collectProbedPages(): ProbedPage[] {
  const pages: ProbedPage[] = [];
  for (const slug of listIntegrationSlugs()) {
    for (const route of PROBED_ROUTES) {
      const file = path.join(
        INTEGRATIONS_DIR,
        slug,
        "src/app/demos",
        route,
        "page.tsx",
      );
      // agentic-chat is universal; tool-rendering is present only where the
      // integration exposes it. Absent pages are simply not probed → skip.
      if (existsSync(file)) pages.push({ slug, route, file });
    }
  }
  return pages;
}

/**
 * Classify every `<CopilotChat …>` JSX usage in a source file via the TS AST.
 * `selfClosing` counts the attribute-BEARING self-closing form; `withChildren`
 * counts the attribute-OMITTING render-prop/slot form.
 */
function classifyCopilotChatUsage(file: string): {
  selfClosing: number;
  withChildren: number;
} {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  let selfClosing = 0;
  let withChildren = 0;

  const tagText = (name: ts.JsxTagNameExpression): string => name.getText(sf);

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      tagText(node.tagName) === COPILOT_CHAT_TAG
    ) {
      selfClosing += 1;
    } else if (
      ts.isJsxElement(node) &&
      tagText(node.openingElement.tagName) === COPILOT_CHAT_TAG
    ) {
      withChildren += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { selfClosing, withChildren };
}

describe("d4 probe domDone gate: probed-route pages emit data-copilot-running", () => {
  const pages = collectProbedPages();

  it("finds the universal agentic-chat page for every integration", () => {
    // Sanity: the probe navigates to /demos/agentic-chat for EVERY slug, so
    // each integration must contribute one. If this drops to zero the scan
    // is mis-rooted and the whole guard would silently pass on nothing.
    const agenticPages = pages.filter((p) => p.route === "agentic-chat");
    expect(agenticPages.length).toBeGreaterThanOrEqual(
      listIntegrationSlugs().length,
    );
  });

  it.each(pages.map((p) => [`${p.slug}/${p.route}`, p] as const))(
    "%s renders <CopilotChat/> in the attribute-bearing self-closing form (not the children render-prop form)",
    (_label, page) => {
      const { selfClosing, withChildren } = classifyCopilotChatUsage(page.file);
      // Must render CopilotChat in the self-closing (attribute-bearing) form:
      // this is the branch of CopilotChatView that emits
      // data-testid="copilot-chat" + data-copilot-running, which the D4 probe's
      // domDone gate reads. Zero → the page dropped <CopilotChat/> for a custom
      // chat UI that won't emit the attribute.
      expect(selfClosing).toBeGreaterThanOrEqual(1);
      // Must NOT use the render-prop/slot children form on a probed route: that
      // branch (`if (children)` in CopilotChatView) returns a display:contents
      // wrapper with NO data-copilot-running, silently regressing the cell to
      // the ~60s / double-send fallback path.
      expect(withChildren).toBe(0);
    },
  );
});
