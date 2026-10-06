import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { inlineSnippets } from "@/lib/docs-render";

// PE-75. The rule "the provider's `agent` prop is a KEY of the runtime's
// `agents` map" was undocumented for every framework. It is authored once in
// `snippets/agent-name-binding.mdx` and pulled into two places, because no
// single page reaches every reader:
//
//   - `docs/backend/copilot-runtime.mdx` is the root Runtime page. Under
//     `docs_mode: generated` the root MDX wins, so this is what langgraph-*,
//     google-adk, strands and claude-sdk-* readers actually see.
//   - `snippets/copilot-runtime.mdx` is the shared body that the `authored`
//     frameworks' own Runtime pages import (Mastra, AG2) and which therefore
//     SHADOWS the root page for them.
//
// Wiring one and not the other silently leaves half the audience without the
// rule, which is invisible in a diff. These assertions render the real pages
// through the real snippet inliner and fail if either path comes unwired.

const CONTENT = path.resolve(__dirname, "..", "..", "content");
const RULE = "must equal a **key of the runtime's `agents` map**";

// Collapse whitespace: the authored prose is hard-wrapped, so a marker phrase
// can straddle a line break and a literal substring match would be testing the
// wrap column rather than the content.
function render(rel: string): string {
  const raw = inlineSnippets(
    fs.readFileSync(path.join(CONTENT, rel), "utf-8"),
    rel,
  );
  return raw.replace(/\s+/g, " ");
}

describe("agent-name binding rule", () => {
  it("reaches the framework-agnostic root Runtime page", () => {
    expect(render("docs/backend/copilot-runtime.mdx")).toContain(RULE);
  });

  // Mastra is `docs_mode: authored` and its Runtime page imports the shared
  // body, so this also proves two-level snippet nesting resolves.
  it("reaches the authored frameworks that shadow the root page", () => {
    for (const rel of [
      "docs/integrations/mastra/copilot-runtime.mdx",
      "docs/integrations/ag2/copilot-runtime.mdx",
    ]) {
      expect(render(rel), rel).toContain(RULE);
    }
  });

  // Mastra is the framework where the key is DERIVED rather than written
  // literally, so it is the one that needs the record-key-vs-`id` statement.
  it("names the Mastra record key as the binding", () => {
    expect(render("docs/integrations/mastra/copilot-runtime.mdx")).toContain(
      "`new Mastra({ agents: { ... } })`, not by the agent's `id`",
    );
  });

  it("inlines cleanly, leaving no unresolved reference or cycle", () => {
    for (const rel of [
      "docs/backend/copilot-runtime.mdx",
      "docs/integrations/mastra/copilot-runtime.mdx",
    ]) {
      const out = render(rel);
      expect(out, rel).not.toContain("<AgentNameBinding");
      expect(out, rel).not.toContain("snippet cycle");
    }
  });
});
