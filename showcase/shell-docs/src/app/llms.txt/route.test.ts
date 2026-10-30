import { expect, test } from "vitest";
import {
  CURATED_FRAMEWORK_PAGES,
  CURATED_LLM_PAGES,
} from "@/lib/curated-llm-pages";
import { getAllLlmPages } from "@/lib/llm-text";
import { getBaseUrl } from "@/lib/sitemap-helpers";
import { GET } from "./route";

test("exports unique curated links that resolve to published pages and the full corpus", async () => {
  const response = GET();
  const body = await response.text();
  const baseUrl = getBaseUrl();
  const pages = [...CURATED_FRAMEWORK_PAGES, ...CURATED_LLM_PAGES];
  const published = new Set(
    getAllLlmPages({ channelGuideVariants: "content-unique" }).map(
      (page) => page.url,
    ),
  );
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(body).toContain("](" + baseUrl + "/llms-full.txt)");
  expect(new Set(pages.map((page) => page.url)).size).toBe(pages.length);
  for (const page of pages) {
    expect(body).toContain("](" + baseUrl + "/" + page.url + ")");
    if (page.url) expect(published.has(page.url), page.url).toBe(true);
  }
});

test("keeps one canonical Vue entry in the curated index", async () => {
  const body = await GET().text();
  const vuePages = CURATED_LLM_PAGES.filter(
    (page) => page.url === "vue" || page.url.startsWith("vue/"),
  );

  expect(vuePages).toEqual([
    expect.objectContaining({ url: "vue", title: "Vue Frontend" }),
  ]);
  expect(body).toContain(`- [Vue Frontend](${getBaseUrl()}/vue):`);
});
