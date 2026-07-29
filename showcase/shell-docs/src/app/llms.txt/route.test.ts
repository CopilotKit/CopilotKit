import { expect, test, vi } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  channelGuideHref,
} from "@/lib/channel-guide-routes";
import { getAllLlmPages } from "@/lib/llm-text";
import { getDocsMode, getIntegrations } from "@/lib/registry";
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

test("publishes every channel/framework discovery URL from the all mode", async () => {
  const response = GET();
  const body = await response.text();
  const visibleFrameworks = getIntegrations().filter(
    (integration) => getDocsMode(integration.slug) !== "hidden",
  );

  expect(getAllLlmPages).toHaveBeenCalledWith({
    channelGuideVariants: "all",
  });
  for (const frontend of CHANNEL_FRONTENDS) {
    for (const integration of visibleFrameworks) {
      expect(body).toContain(
        `/${channelGuideHref(frontend, integration.slug, "").slice(1)})`,
      );
    }
  }
  expect(body).toContain("/slack/mastra/tools)");
  expect(body).toContain("/teams/langgraph-fastapi/interactive)");
  expect(body).not.toContain("/channels/tools");

  const expectedScopedCount =
    CHANNEL_FRONTENDS.length *
    visibleFrameworks.length *
    (CHANNEL_GUIDE_ROUTES.length + 1);
  const pages = vi.mocked(getAllLlmPages).mock.results[0]?.value as
    | ReturnType<typeof getAllLlmPages>
    | undefined;
  expect(
    pages?.filter((page) =>
      CHANNEL_FRONTENDS.some(
        (frontend) =>
          page.url === frontend || page.url.startsWith(`${frontend}/`),
      ),
    ),
  ).toHaveLength(expectedScopedCount);
});
