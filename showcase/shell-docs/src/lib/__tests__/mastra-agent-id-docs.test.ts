import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const pages = [
  "quickstart.mdx",
  "generative-ui/tool-rendering.mdx",
  "generative-ui/state-rendering.mdx",
  "shared-state/in-app-agent-read.mdx",
  "shared-state/in-app-agent-write.mdx",
  "shared-state/predictive-state-updates.mdx",
];

/**
 * The Mastra agent a reader sees on a page. Hand-written pages carry it
 * inline; Showcase-sourced pages render it from a `<Snippet>`, so check the
 * rendered output there instead of the raw MDX.
 */
function agentSource(page: string): string {
  const source = readFileSync(
    new URL(`../../content/docs/integrations/mastra/${page}`, import.meta.url),
    "utf8",
  );
  if (/new Agent\(\{/.test(source)) return source;

  const loadSlug = `integrations/mastra/${page.replace(/\.mdx$/, "")}`;
  const doc = loadDoc(loadSlug);
  if (!doc) throw new Error(`Missing ${loadSlug}`);
  return renderPageToLlmText(
    {
      url: `mastra/${page.replace(/\.mdx$/, "")}`,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug,
      framework: "mastra",
    },
    { framework: "mastra" },
  );
}

test.each(pages)("includes an id in every Mastra agent on %s", (page) => {
  const source = agentSource(page);

  expect(source.match(/new Agent\(\{/g)).toHaveLength(1);
  expect(source.match(/new Agent\(\{\s*id:/g)).toHaveLength(1);
});
