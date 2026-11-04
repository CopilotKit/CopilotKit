import { expect, test } from "vitest";
import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { Callout } from "fumadocs-ui/components/callout";
import remarkGfm from "remark-gfm";
import { GET } from "../../app/llms-mdx/[[...slug]]/route";
import {
  buildFrameworkOnlyNav,
  docCandidateOrder,
  loadDoc,
} from "../docs-render";
import type { NavNode } from "../docs-render";
import { getDocsFolder, getDocsMode } from "../registry";

const slug = "prebuilt-components/popup";

function resolvePopup(framework: string) {
  for (const candidate of docCandidateOrder(
    getDocsMode(framework),
    getDocsFolder(framework),
    slug,
  )) {
    const doc = loadDoc(candidate);
    if (doc) return { candidate, doc };
  }
  throw new Error(`No popup guide for ${framework}`);
}

function hasPopup(nodes: NavNode[]): boolean {
  return nodes.some((node) =>
    node.type === "page"
      ? node.slug === slug
      : node.type === "group" && hasPopup(node.children),
  );
}

test("Deep Agents popup route and navigation use its authored guide", () => {
  const { candidate, doc } = resolvePopup("deepagents");
  expect(candidate).toBe(`integrations/deepagents/${slug}`);
  expect(doc.source).not.toMatch(/<(?:Snippet|InlineDemo)\b/);
  expect(hasPopup(buildFrameworkOnlyNav("deepagents"))).toBe(true);
});

test("Deep Agents popup serves usable Markdown and renderable example code", async () => {
  const response = await GET(
    new Request("http://localhost/deepagents/prebuilt-components/popup.md"),
    { params: Promise.resolve({ slug: ["deepagents", ...slug.split("/")] }) },
  );
  expect(response.status).toBe(200);
  const markdown = await response.text();
  expect(markdown).toMatch(/```tsx[\s\S]+<CopilotPopup[\s\S]+```/);
  expect(markdown).not.toMatch(
    /Missing snippet|snippet skipped|No demo found|Not available for/,
  );
  const { content } = await compileMDX({
    source: resolvePopup("deepagents").doc.source,
    components: { Callout },
    options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
  });
  const html = renderToStaticMarkup(content);
  expect(html).toContain("<pre>");
  expect(html).not.toMatch(/Missing snippet|No demo found|Not available for/);
});

test("Showcase-backed popup routes keep their source-bound guide", () => {
  const { candidate, doc } = resolvePopup("langgraph-python");
  expect(candidate).toBe(slug);
  expect(doc.source).toContain('<Snippet region="popup-basic-setup"');
});
