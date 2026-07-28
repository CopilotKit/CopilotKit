import { expect, test } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  channelGuideHref,
} from "@/lib/channel-guide-routes";
import { loadDoc } from "@/lib/docs-render";
import { getFrontendContentSlug } from "@/lib/frontend-page-content";
import { getDocsMode, getIntegrations, ROOT_FRAMEWORK } from "@/lib/registry";
import { resolveLastModified } from "@/lib/sitemap-helpers";
import sitemap from "./sitemap";

const visibleChannelFrameworks = getIntegrations().filter(
  ({ slug }) => getDocsMode(slug) !== "hidden",
);
const hiddenFrameworks = getIntegrations().filter(
  ({ slug }) => getDocsMode(slug) === "hidden",
);

function expectedChannelPaths(): Set<string> {
  const paths = new Set<string>(["/channels"]);

  for (const frontend of CHANNEL_FRONTENDS) {
    for (const framework of visibleChannelFrameworks) {
      paths.add(channelGuideHref(frontend, framework.slug, ""));
      for (const guide of CHANNEL_GUIDE_ROUTES) {
        paths.add(channelGuideHref(frontend, framework.slug, guide.slug));
      }
    }
  }

  return paths;
}

function sitemapPaths(): string[] {
  return sitemap().map(
    (entry) => new URL(entry.url, "http://localhost").pathname,
  );
}

function actualChannelPaths(paths: readonly string[]): Set<string> {
  return new Set(
    paths.filter(
      (pathname) =>
        pathname === "/channels" ||
        pathname.startsWith("/channels/") ||
        CHANNEL_FRONTENDS.some(
          (frontend) =>
            pathname === `/${frontend}` || pathname.startsWith(`/${frontend}/`),
        ),
    ),
  );
}

test("publishes exactly the canonical Channels URL matrix", () => {
  const paths = sitemapPaths();
  const expected = expectedChannelPaths();
  const actual = actualChannelPaths(paths);

  expect(expected.size).toBe(305);
  expect([...actual].sort()).toEqual([...expected].sort());
  expect(paths.filter((pathname) => pathname === "/channels")).toHaveLength(1);
  expect(paths.some((pathname) => pathname.startsWith("/channels/"))).toBe(
    false,
  );
  expect(paths).not.toContain("/slack/using-these-docs");
  expect(paths).not.toContain("/teams/using-these-docs");
});

test("collapses Built-in Agent channel URLs and expands every selected framework", () => {
  const paths = actualChannelPaths(sitemapPaths());

  for (const frontend of CHANNEL_FRONTENDS) {
    expect(paths).toContain(`/${frontend}`);
    expect(paths).not.toContain(`/${frontend}/${ROOT_FRAMEWORK}`);
    expect(
      [...paths].some((pathname) =>
        pathname.startsWith(`/${frontend}/${ROOT_FRAMEWORK}/`),
      ),
    ).toBe(false);

    for (const framework of visibleChannelFrameworks.filter(
      ({ slug }) => slug !== ROOT_FRAMEWORK,
    )) {
      expect(paths).toContain(`/${frontend}/${framework.slug}`);
      for (const guide of CHANNEL_GUIDE_ROUTES) {
        expect(paths).toContain(
          channelGuideHref(frontend, framework.slug, guide.slug),
        );
      }
    }
  }
});

test("publishes every sitemap URL at most once", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(new Set(urls).size).toBe(urls.length);
});

test("excludes every hidden framework from every sitemap surface", () => {
  const paths = sitemapPaths();

  expect(hiddenFrameworks.length).toBeGreaterThan(0);
  for (const framework of hiddenFrameworks) {
    expect(
      paths.filter((pathname) =>
        pathname.split("/").filter(Boolean).includes(framework.slug),
      ),
    ).toEqual([]);
  }
});

test("uses the exact quickstart and shared-guide source dates for channel pages", () => {
  const expectedSourceByPath = new Map<string, string>();
  const channelsOverview = loadDoc("channels");
  expect(channelsOverview).not.toBeNull();
  expectedSourceByPath.set("/channels", channelsOverview!.filePath);

  for (const frontend of CHANNEL_FRONTENDS) {
    const quickstart = loadDoc(getFrontendContentSlug(frontend));
    expect(quickstart).not.toBeNull();

    for (const framework of visibleChannelFrameworks) {
      expectedSourceByPath.set(
        channelGuideHref(frontend, framework.slug, ""),
        quickstart!.filePath,
      );

      for (const guide of CHANNEL_GUIDE_ROUTES) {
        const guideDoc = loadDoc(guide.sourceSlug);
        expect(guideDoc).not.toBeNull();
        expectedSourceByPath.set(
          channelGuideHref(frontend, framework.slug, guide.slug),
          guideDoc!.filePath,
        );
      }
    }
  }

  const entriesByPath = new Map(
    sitemap().map((entry) => [
      new URL(entry.url, "http://localhost").pathname,
      entry,
    ]),
  );

  expect(expectedSourceByPath.size).toBe(305);
  for (const [pathname, sourcePath] of expectedSourceByPath) {
    const entry = entriesByPath.get(pathname);
    expect(entry, `missing ${pathname}`).toBeDefined();
    expect(entry!.lastModified).toBeInstanceOf(Date);
    expect(new Date(entry!.lastModified!).getTime()).toBe(
      resolveLastModified(sourcePath).getTime(),
    );
  }
});

test("publishes Channels overview only on its global canonical surface", () => {
  const paths = sitemap().map(
    (entry) => new URL(entry.url, "http://localhost").pathname,
  );

  expect(paths).toContain("/channels");
  expect(
    paths.filter((pathname) => pathname.split("/").indexOf("channels") > 1),
  ).toEqual([]);
});

test("publishes the Angular feature catalog at its canonical URL", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(urls.some((url) => url.endsWith("/angular/features"))).toBe(true);
});

test("publishes every Angular task guide at its canonical URL", () => {
  const urls = sitemap().map((entry) => entry.url);
  const guidePaths = [
    "/angular/guides/chat-ui",
    "/angular/guides/frontend-tools-generative-ui",
    "/angular/guides/a2ui",
    "/angular/guides/voice-multimodal",
    "/angular/guides/human-in-the-loop",
    "/angular/guides/shared-state",
    "/angular/guides/threads-memory-attachments-headless",
  ];

  for (const guidePath of guidePaths) {
    expect(urls.some((url) => url.endsWith(guidePath))).toBe(true);
  }
});

test("publishes shared Runtime and Intelligence docs once on the Angular surface", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(
    urls.some((url) => url.endsWith("/angular/backend/copilot-runtime")),
  ).toBe(true);
  expect(
    urls.some((url) => url.endsWith("/angular/premium/intelligence-platform")),
  ).toBe(true);
  expect(urls.some((url) => url.endsWith("/angular/auth"))).toBe(true);
  expect(
    urls.some((url) =>
      url.endsWith("/angular/langgraph-python/premium/intelligence-platform"),
    ),
  ).toBe(false);
});

test("publishes Angular backend roots and backend-owned pages without a full cross-product", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(urls.some((url) => url.endsWith("/angular/langgraph-python"))).toBe(
    true,
  );
  expect(
    urls.some((url) => url.endsWith("/angular/langgraph-python/quickstart")),
  ).toBe(true);
  expect(
    urls.some((url) => url.endsWith("/angular/langgraph-python/auth")),
  ).toBe(false);
});
