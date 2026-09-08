import { beforeEach, expect, test, vi } from "vitest";

import {
  CURATED_FRAMEWORK_PAGES,
  CURATED_LLM_PAGES,
} from "@/lib/curated-llm-pages";
import { getAllLlmPages } from "@/lib/llm-text";
import { INTELLIGENCE_ONBOARDING_PROMPT } from "@/lib/intelligence-onboarding-prompt";
import { getDocsMode, getIntegrations } from "@/lib/registry";
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

test("exposes the shared onboarding prompt before the research links", async () => {
  const first = await GET().text();
  const second = await GET().text();
  expect(first).toContain(INTELLIGENCE_ONBOARDING_PROMPT);
  expect(first).toContain("fresh 12-character hexadecimal run ID");
  expect(
    first.indexOf("## Add CopilotKit with your coding agent"),
  ).toBeLessThan(first.indexOf("## Use your existing agent framework"));
  expect(first).toBe(second);
});

test("publishes the curated decision index and exhaustive retrieval link", async () => {
  const response = GET();
  const body = await response.text();
  const baseUrl = getBaseUrl();

  expect(getAllLlmPages).not.toHaveBeenCalled();
  expect(body).toContain(`[llms-full.txt](${baseUrl}/llms-full.txt)`);
  for (const page of [...CURATED_FRAMEWORK_PAGES, ...CURATED_LLM_PAGES]) {
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

test("leads with every visible external framework and validates its entry points", async () => {
  const body = await GET().text();
  const pages = [...CURATED_FRAMEWORK_PAGES, ...CURATED_LLM_PAGES];
  const urls = pages.map((page) => page.url);
  const exhaustiveUrls = new Set(
    getAllLlmPages({ channelGuideVariants: "content-unique" }).map(
      (page) => page.url,
    ),
  );

  for (const integration of getIntegrations()) {
    if (integration.slug === "built-in-agent") continue;
    for (const url of [integration.slug, `${integration.slug}/quickstart`]) {
      if (getDocsMode(integration.slug) === "hidden") {
        expect(urls).not.toContain(url);
      } else {
        expect(urls).toContain(url);
        expect(exhaustiveUrls.has(url), url).toBe(true);
      }
    }
  }
  expect(new Set(urls).size).toBe(urls.length);
  expect(body.indexOf("## Use your existing agent framework")).toBeLessThan(
    body.indexOf("## Capabilities, frontends, and shared guides"),
  );
  expect(body).toContain(
    "Bare root implementation guides can describe CopilotKit's built-in agent",
  );
  expect(body).toContain("Built-in Agent Quickstart");
});

test("publishes Vue routes from the derived frontend navigation", async () => {
  const response = GET();
  const body = await response.text();

  for (const url of [
    "vue",
    "vue/using-these-docs",
    "vue/prebuilt-components",
    "vue/threads",
    "vue/threads-import",
    "vue/generative-ui/tool-rendering",
    "vue/human-in-the-loop",
    "vue/inspector",
    "vue/custom-look-and-feel/css",
    "vue/custom-look-and-feel/reasoning-messages",
    "vue/generative-ui/reasoning",
    "vue/multimodal-attachments",
    "vue/prebuilt-components/chat",
    "vue/prebuilt-components/chat-controls",
    "vue/prebuilt-components/popup",
    "vue/prebuilt-components/sidebar",
    "vue/voice",
  ]) {
    expect(body).toContain(`/${url})`);
  }
  expect(body).not.toContain("/vue/guides/generative-ui)");
  expect(body).not.toContain("/vue/guides/threads-and-drawer)");
  expect(body).not.toContain("/vue/generative-ui/a2ui)");
});
