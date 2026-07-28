import { describe, expect, it } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  DEFAULT_CHANNEL_FRAMEWORK,
  channelGuideHref,
  getChannelGuidePublicSlug,
  getChannelGuideSourceSlug,
  isChannelGuideSlug,
  resolveChannelGuideRoute,
} from "../channel-guide-routes";
import type { ResolveChannelGuideRouteInput } from "../channel-guide-routes";

function resolveGuide(overrides: Partial<ResolveChannelGuideRouteInput> = {}) {
  return resolveChannelGuideRoute({
    frontend: "slack",
    framework: null,
    slugPath: "tools",
    frameworkDocsMode: "authored",
    ...overrides,
  });
}

describe("channel guide routes", () => {
  it("defines the supported frontends and implicit framework", () => {
    expect(CHANNEL_FRONTENDS).toEqual(["slack", "teams"]);
    expect(DEFAULT_CHANNEL_FRAMEWORK).toBe("built-in-agent");
  });

  it("keeps the public guide order and source metadata explicit", () => {
    expect(CHANNEL_GUIDE_ROUTES).toEqual([
      {
        slug: "intelligence",
        sourceSlug: "channels/intelligence",
        navTitle: "Configure the Channel in Intelligence",
        section: "getting-started",
      },
      {
        slug: "tools",
        sourceSlug: "channels/tools",
        navTitle: "Tools and context",
        section: "build",
      },
      {
        slug: "interactive",
        sourceSlug: "channels/interactive",
        navTitle: "Interactive messages and approvals",
        section: "build",
      },
      {
        slug: "threads-and-state",
        sourceSlug: "channels/threads-and-state",
        navTitle: "Threads and state",
        section: "build",
      },
      {
        slug: "reference/channel",
        sourceSlug: "channels/reference/channel",
        navTitle: "Channel",
        section: "reference",
      },
      {
        slug: "reference/thread",
        sourceSlug: "channels/reference/thread",
        navTitle: "Thread",
        section: "reference",
      },
      {
        slug: "reference/callbacks",
        sourceSlug: "channels/reference/callbacks",
        navTitle: "JSX callbacks",
        section: "reference",
      },
    ]);
  });

  it("maps every public slug to its source slug and back", () => {
    for (const route of CHANNEL_GUIDE_ROUTES) {
      expect(getChannelGuideSourceSlug(route.slug)).toBe(route.sourceSlug);
      expect(getChannelGuidePublicSlug(route.sourceSlug)).toBe(route.slug);
      expect(isChannelGuideSlug(route.slug)).toBe(true);
    }
  });

  it("does not alias the channels overview or unknown paths", () => {
    for (const slug of ["channels", "unknown", "", "/"]) {
      expect(getChannelGuideSourceSlug(slug)).toBeNull();
      expect(getChannelGuidePublicSlug(slug)).toBeNull();
      expect(isChannelGuideSlug(slug)).toBe(false);
    }
  });

  it("normalizes leading, trailing, and repeated slashes", () => {
    expect(getChannelGuideSourceSlug("//reference///thread/")).toBe(
      "channels/reference/thread",
    );
    expect(getChannelGuidePublicSlug("/channels//reference///callbacks/")).toBe(
      "reference/callbacks",
    );
    expect(isChannelGuideSlug("///threads-and-state//")).toBe(true);
  });

  it("builds implicit and selected-backend guide hrefs", () => {
    expect(channelGuideHref("slack", "built-in-agent", "tools")).toBe(
      "/slack/tools",
    );
    expect(channelGuideHref("slack", "mastra", "tools")).toBe(
      "/slack/mastra/tools",
    );
    expect(
      channelGuideHref("teams", "built-in-agent", "reference/thread"),
    ).toBe("/teams/reference/thread");
    expect(
      channelGuideHref("teams", "built-in-agent", "//reference///thread/"),
    ).toBe("/teams/reference/thread");
  });

  it("treats null and undefined frameworks as implicit", () => {
    expect(channelGuideHref("slack", null, "tools")).toBe("/slack/tools");
    expect(channelGuideHref("teams", undefined, "reference/thread")).toBe(
      "/teams/reference/thread",
    );
    expect(channelGuideHref("slack", null, "")).toBe("/slack");
    expect(channelGuideHref("teams", undefined, "///")).toBe("/teams");
  });

  it("returns frontend and framework roots for an empty guide slug", () => {
    expect(channelGuideHref("slack", "built-in-agent", "")).toBe("/slack");
    expect(channelGuideHref("teams", "mastra", "///")).toBe("/teams/mastra");
  });
});

describe("channel guide route resolution", () => {
  it("resolves an implicit framework to built-in agent", () => {
    expect(resolveGuide({ slugPath: "//tools/" })).toEqual({
      frontend: "slack",
      framework: "built-in-agent",
      slugPath: "tools",
      sourceSlug: "channels/tools",
      canonicalPath: "/slack/tools",
    });
  });

  it("preserves a selected backend in the resolution and canonical path", () => {
    expect(
      resolveGuide({
        frontend: "teams",
        framework: "mastra",
        slugPath: "reference/thread",
        frameworkDocsMode: "generated",
      }),
    ).toEqual({
      frontend: "teams",
      framework: "mastra",
      slugPath: "reference/thread",
      sourceSlug: "channels/reference/thread",
      canonicalPath: "/teams/mastra/reference/thread",
    });
  });

  it("collapses an explicit built-in agent segment from the canonical path", () => {
    expect(
      resolveGuide({
        frontend: "teams",
        framework: "built-in-agent",
        slugPath: "reference/thread",
      }),
    ).toEqual({
      frontend: "teams",
      framework: "built-in-agent",
      slugPath: "reference/thread",
      sourceSlug: "channels/reference/thread",
      canonicalPath: "/teams/reference/thread",
    });
  });

  it("rejects guides for hidden backends", () => {
    expect(
      resolveGuide({
        framework: "mastra",
        frameworkDocsMode: "hidden",
      }),
    ).toBeNull();
  });

  it("rejects unknown guide slugs", () => {
    expect(resolveGuide({ slugPath: "unknown" })).toBeNull();
  });

  it("rejects non-channel frontends", () => {
    expect(resolveGuide({ frontend: "angular" })).toBeNull();
  });
});
