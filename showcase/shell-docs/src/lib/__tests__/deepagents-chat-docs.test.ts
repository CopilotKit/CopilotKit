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

const slug = "prebuilt-components/chat";

function resolveChat(framework: string) {
  for (const candidate of docCandidateOrder(
    getDocsMode(framework),
    getDocsFolder(framework),
    slug,
  )) {
    const doc = loadDoc(candidate);
    if (doc) return { candidate, doc };
  }
  throw new Error(`No chat guide for ${framework}`);
}

function hasChat(nodes: NavNode[]): boolean {
  return nodes.some((node) =>
    node.type === "page"
      ? node.slug === slug
      : node.type === "group" && hasChat(node.children),
  );
}

test("Deep Agents resolves an authored chat guide without nonexistent demo bindings", () => {
  const { candidate, doc } = resolveChat("deepagents");
  expect(candidate).toBe(`integrations/deepagents/${slug}`);
  expect(doc.fm.defaultCell).toBeUndefined();
  expect(doc.source).not.toMatch(/<(?:Snippet|InlineDemo)\b/);
  expect(doc.source).toContain("CopilotChat works with Deep Agents");
  expect(doc.source).toContain("embedded Deep Agents demo");
  expect(hasChat(buildFrameworkOnlyNav("deepagents"))).toBe(true);
});

test("raw Markdown includes both complete examples and no missing-snippet fallback", async () => {
  const response = await GET(
    new Request("http://localhost/deepagents/prebuilt-components/chat.md"),
    { params: Promise.resolve({ slug: ["deepagents", ...slug.split("/")] }) },
  );
  expect(response.status).toBe(200);
  const markdown = await response.text();
  expect(markdown).toContain("## Basic setup");
  expect(markdown).toContain("## Code example");
  expect(markdown).toContain("export default function ChatPage");
  expect(markdown).toContain("function ChatWithSuggestions");
  expect(markdown).toContain('consumerAgentId: "sample_agent"');
  expect(markdown.match(/```tsx/g)).toHaveLength(2);
  expect(markdown).not.toMatch(
    /Missing snippet|snippet skipped|No demo found|Not available for/,
  );
});

test("the authored MDX renders both examples and the demo-only notice as HTML", async () => {
  const { doc } = resolveChat("deepagents");
  const { content } = await compileMDX({
    source: doc.source,
    components: { Callout },
    options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
  });
  const html = renderToStaticMarkup(content);
  expect(html).toContain("CopilotChat works with Deep Agents");
  expect(html).toContain("Demo availability");
  expect(html).toContain("function ChatWithSuggestions");
  expect(html.match(/<pre>/g)).toHaveLength(2);
  expect(html).not.toMatch(/Missing snippet|No demo found|Not available for/);
});

test("a showcase-backed framework retains its original source-bound chat guide", () => {
  const { candidate, doc } = resolveChat("langgraph-python");
  expect(candidate).toBe(slug);
  expect(doc.fm.defaultCell).toBe("agentic-chat");
  expect(doc.source).toContain('<Snippet region="provider-setup"');
  expect(doc.source).toContain('<Snippet region="chat-component"');
});
