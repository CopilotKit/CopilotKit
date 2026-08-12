import { expect, test } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  channelConnectHref,
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
const expectedChannelPathCount =
  CHANNEL_FRONTENDS.length *
  visibleChannelFrameworks.length *
  (CHANNEL_GUIDE_ROUTES.length + 1);

function expectedChannelPaths(): Set<string> {
  const paths = new Set<string>();

  for (const frontend of CHANNEL_FRONTENDS) {
    for (const framework of visibleChannelFrameworks) {
      paths.add(channelConnectHref(frontend, framework.slug));
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
    paths.filter((pathname) =>
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

  expect(expected.size).toBe(expectedChannelPathCount);
  expect([...actual].sort()).toEqual([...expected].sort());
  expect(paths).not.toContain("/channels");
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
    expect(paths).toContain(`/${frontend}/connect`);
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
      expect(paths).toContain(channelConnectHref(frontend, framework.slug));
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

test("publishes the public AEO policy at its canonical URL", () => {
  const policy = loadDoc("aeo");

  expect(policy?.fm).toMatchObject({
    title: "Public AEO surface contract",
    description: expect.any(String),
  });
  expect(sitemapPaths()).toContain("/aeo");
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

test("uses the exact connection-guide and shared-guide source dates for channel pages", () => {
  const expectedSourceByPath = new Map<string, string>();

  for (const frontend of CHANNEL_FRONTENDS) {
    const connectionGuide = loadDoc(getFrontendContentSlug(frontend));
    expect(connectionGuide).not.toBeNull();

    for (const framework of visibleChannelFrameworks) {
      expectedSourceByPath.set(
        channelConnectHref(frontend, framework.slug),
        connectionGuide!.filePath,
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

  expect(expectedSourceByPath.size).toBe(expectedChannelPathCount);
  for (const [pathname, sourcePath] of expectedSourceByPath) {
    const entry = entriesByPath.get(pathname);
    expect(entry, `missing ${pathname}`).toBeDefined();
    expect(entry!.lastModified).toBeInstanceOf(Date);
    expect(new Date(entry!.lastModified!).getTime()).toBe(
      resolveLastModified(sourcePath).getTime(),
    );
  }
});

test("omits the Channels overview and publishes the global SDK reference", () => {
  const paths = sitemap().map(
    (entry) => new URL(entry.url, "http://localhost").pathname,
  );

  expect(paths).not.toContain("/channels");
  expect(paths).toEqual(
    expect.arrayContaining([
      "/reference/channels",
      "/reference/channels/classes/Channel",
      "/reference/channels/classes/Thread",
      "/reference/channels/components/Button",
      "/reference/channels/functions/createChannel",
      "/reference/channels/types/JSXCallbacks",
      "/reference/channels/types/StateStore",
    ]),
  );
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
