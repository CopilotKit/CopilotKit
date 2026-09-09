import { beforeEach, expect, test, vi } from "vitest";

import { CURATED_LLM_PAGES } from "@/lib/curated-llm-pages";
import { getAllLlmPages } from "@/lib/llm-text";
import { getBaseUrl } from "@/lib/sitemap-helpers";
import { GET } from "./route";

vi.mock("@/lib/llm-text", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    getAllLlmPages: typeof getAllLlmPages;
  };
  return {
    ...actual,
    getAllLlmPages: vi.fn(actual.getAllLlmPages),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("publishes the curated decision index and exhaustive retrieval link", async () => {
  const response = GET();
  const body = await response.text();
  const baseUrl = getBaseUrl();

  expect(getAllLlmPages).not.toHaveBeenCalled();
  expect(body).toContain(`[llms-full.txt](${baseUrl}/llms-full.txt)`);
  for (const page of CURATED_LLM_PAGES) {
    expect(body).toContain(
      `- [${page.title}](${baseUrl}/${page.url}): ${page.description}`,
    );
  }
  expect(body).not.toContain("/slack/mastra/tools)");
  expect(body).not.toContain("/teams/langgraph-fastapi/interactive)");
});

test("keeps the curated policy ordered, unique, and on canonical routes", () => {
  const urls = CURATED_LLM_PAGES.map((page) => page.url);
  const titles = CURATED_LLM_PAGES.map((page) => page.title);
  const exhaustiveUrls = new Set(
    getAllLlmPages({ channelGuideVariants: "content-unique" }).map(
      (page) => page.url,
    ),
  );

  expect(urls.slice(0, 11)).toEqual([
    "",
    "agentic-chat-ui",
    "concepts/generative-ui-overview",
    "human-in-the-loop",
    "threads",
    "learning",
    "intelligence/overview",
    "slack",
    "teams",
    "langgraph-python/threads-import",
    "google-adk/threads-import",
  ]);
  expect(new Set(urls).size).toBe(urls.length);
  expect(new Set(titles).size).toBe(titles.length);
  expect(urls.filter((url) => url.startsWith("langgraph-"))).toEqual([
    "langgraph-python/threads-import",
    "langgraph-python/quickstart",
  ]);
  expect(
    urls.some((url) =>
      /(?:^|\/)(?:contributing|migrate|troubleshooting|whats-new)(?:\/|$)/.test(
        url,
      ),
    ),
  ).toBe(false);
  expect(urls.filter((url) => /^(?:slack|teams)(?:\/|$)/.test(url))).toEqual([
    "slack",
    "teams",
  ]);

  for (const page of CURATED_LLM_PAGES) {
    expect(page.description).toMatch(/^[^\n]+[.!?]$/);
    if (page.url) expect(exhaustiveUrls.has(page.url), page.url).toBe(true);
  }
});
