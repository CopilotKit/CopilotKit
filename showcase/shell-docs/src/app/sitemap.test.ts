import { expect, test } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  channelConnectHref,
  channelGuideHref,
} from "@/lib/channel-guide-routes";
import { getDocsMode, getIntegrations } from "@/lib/registry";
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
