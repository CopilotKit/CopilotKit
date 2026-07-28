import { expect, test, vi } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  channelGuideHref,
} from "@/lib/channel-guide-routes";
import { getAllLlmPages, renderPageToLlmText } from "@/lib/llm-text";
import { getDocsMode, getIntegrations } from "@/lib/registry";
import { getBaseUrl } from "@/lib/sitemap-helpers";
import { GET } from "./route";

vi.mock("@/lib/llm-text", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    getAllLlmPages: typeof getAllLlmPages;
    renderPageToLlmText: typeof renderPageToLlmText;
  };
  return {
    ...actual,
    getAllLlmPages: vi.fn(actual.getAllLlmPages),
    renderPageToLlmText: vi.fn(actual.renderPageToLlmText),
  };
});

test("renders every channel quickstart and one shared guide body per provider", async () => {
  const response = GET();
  const body = await response.text();
  const baseUrl = getBaseUrl();
  const visibleFrameworks = getIntegrations().filter(
    (integration) => getDocsMode(integration.slug) !== "hidden",
  );

  expect(getAllLlmPages).toHaveBeenCalledWith({
    channelGuideVariants: "content-unique",
  });

  for (const frontend of CHANNEL_FRONTENDS) {
    for (const integration of visibleFrameworks) {
      const quickstartUrl = channelGuideHref(
        frontend,
        integration.slug,
        "",
      ).slice(1);
      expect(body).toContain(`## Source: ${baseUrl}/${quickstartUrl}\n`);
    }

    for (const guide of CHANNEL_GUIDE_ROUTES) {
      const defaultUrl = channelGuideHref(
        frontend,
        "built-in-agent",
        guide.slug,
      ).slice(1);
      expect(body).toContain(`## Source: ${baseUrl}/${defaultUrl}\n`);
      expect(body).not.toContain(
        `## Source: ${baseUrl}/${channelGuideHref(
          frontend,
          "mastra",
          guide.slug,
        ).slice(1)}\n`,
      );
    }
  }

  expect(body).not.toContain("<FrameworkSetup");
  expect(body).not.toContain(`## Source: ${baseUrl}/channels/tools\n`);

  const pages =
    (vi.mocked(getAllLlmPages).mock.results[0]?.value as
      | ReturnType<typeof getAllLlmPages>
      | undefined) ?? [];
  for (const page of pages) {
    expect(renderPageToLlmText).toHaveBeenCalledWith(page, {
      ...(page.frontend ? { frontend: page.frontend } : {}),
      ...(page.framework ? { framework: page.framework } : {}),
    });
  }
}, 60_000);
