import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const pages = [
  "quickstart.mdx",
  "generative-ui/tool-rendering.mdx",
  "generative-ui/state-rendering.mdx",
  "shared-state/in-app-agent-read.mdx",
  "shared-state/in-app-agent-write.mdx",
  "shared-state/predictive-state-updates.mdx",
];

test.each(pages)("includes an id in every Mastra agent on %s", (page) => {
  const source = readFileSync(
    new URL(`../../content/docs/integrations/mastra/${page}`, import.meta.url),
    "utf8",
  );

  expect(source.match(/new Agent\(\{/g)).toHaveLength(1);
  expect(source.match(/new Agent\(\{\s*id:/g)).toHaveLength(1);
});
