import { expect, test, vi } from "vitest";
import { getAllLlmPages, renderPageToLlmText } from "@/lib/llm-text";
import { getBaseUrl } from "@/lib/sitemap-helpers";
import { GET } from "./route";

vi.mock("@/lib/llm-text", () => ({
  getAllLlmPages: vi.fn(() => [
    { url: "quickstart" },
    { url: "teams/mastra/tools", frontend: "teams", framework: "mastra" },
    { url: "missing" },
  ]),
  renderPageToLlmText: vi.fn((page) =>
    page.url === "missing" ? "" : "body:" + page.url,
  ),
}));

test("exports rendered pages with source links and selected axes, skipping missing bodies", async () => {
  const response = GET();
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  expect(getAllLlmPages).toHaveBeenCalledWith({
    channelGuideVariants: "content-unique",
  });
  expect(body).toContain("## Source: " + getBaseUrl() + "/quickstart");
  expect(body).toContain("body:quickstart");
  expect(body).toContain("body:teams/mastra/tools");
  expect(body).not.toContain("/missing");
  expect(renderPageToLlmText).toHaveBeenCalledWith(
    { url: "teams/mastra/tools", frontend: "teams", framework: "mastra" },
    { frontend: "teams", framework: "mastra" },
  );
});
