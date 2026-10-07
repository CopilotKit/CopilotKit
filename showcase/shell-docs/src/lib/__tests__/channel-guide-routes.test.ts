import { describe, expect, it } from "vitest";

import {
  CHANNEL_GUIDE_ROUTES,
  channelConnectHref,
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
  it("maps every public slug to its source slug and back", () => {
    for (const route of CHANNEL_GUIDE_ROUTES) {
      expect(getChannelGuideSourceSlug(route.slug)).toBe(route.sourceSlug);
      expect(getChannelGuidePublicSlug(route.sourceSlug)).toBe(route.slug);
      expect(isChannelGuideSlug(route.slug)).toBe(true);
    }
  });

  it("does not alias unknown or empty paths", () => {
    for (const slug of ["unknown", "", "/"]) {
      expect(getChannelGuideSourceSlug(slug)).toBeNull();
      expect(getChannelGuidePublicSlug(slug)).toBeNull();
      expect(isChannelGuideSlug(slug)).toBe(false);
    }
  });

  it("maps the shared Channels overview to provider-scoped routes", () => {
    expect(getChannelGuideSourceSlug("overview")).toBe("channels");
    expect(getChannelGuidePublicSlug("channels")).toBe("overview");
    expect(isChannelGuideSlug("overview")).toBe(true);
  });

  it("normalizes leading, trailing, and repeated slashes", () => {
    expect(getChannelGuideSourceSlug("//threads-and-state/")).toBe(
      "channels/threads-and-state",
    );
    expect(getChannelGuidePublicSlug("/channels//interactive/")).toBe(
      "interactive",
    );
    expect(isChannelGuideSlug("///threads-and-state//")).toBe(true);
  });

  it("builds implicit and selected-backend guide hrefs", () => {
    expect(channelGuideHref("slack", "built-in-agent", "overview")).toBe(
      "/slack",
    );
    expect(channelGuideHref("teams", "mastra", "overview")).toBe(
      "/teams/mastra",
    );
    expect(channelGuideHref("slack", "built-in-agent", "tools")).toBe(
      "/slack/tools",
    );
    expect(channelGuideHref("slack", "mastra", "tools")).toBe(
      "/slack/mastra/tools",
    );
    expect(
      channelGuideHref("slack", "built-in-agent", "identity-and-memory"),
    ).toBe("/slack/identity-and-memory");
    expect(
      channelGuideHref("teams", "built-in-agent", "identity-and-memory"),
    ).toBe("/teams/identity-and-memory");
    expect(channelGuideHref("teams", "built-in-agent", "interactive")).toBe(
      "/teams/interactive",
    );
    expect(channelGuideHref("teams", "built-in-agent", "//interactive/")).toBe(
      "/teams/interactive",
    );
  });

  it("treats null and undefined frameworks as implicit", () => {
    expect(channelGuideHref("slack", null, "tools")).toBe("/slack/tools");
    expect(channelGuideHref("teams", undefined, "threads-and-state")).toBe(
      "/teams/threads-and-state",
    );
    expect(channelGuideHref("slack", null, "")).toBe("/slack");
    expect(channelGuideHref("teams", undefined, "///")).toBe("/teams");
  });

  it("returns frontend and framework roots for an empty guide slug", () => {
    expect(channelGuideHref("slack", "built-in-agent", "")).toBe("/slack");
    expect(channelGuideHref("teams", "mastra", "///")).toBe("/teams/mastra");
  });

  it("keeps provider connection guides on explicit child routes", () => {
    expect(channelConnectHref("slack", "built-in-agent")).toBe(
      "/slack/connect",
    );
    expect(channelConnectHref("teams", "mastra")).toBe("/teams/mastra/connect");
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
        slugPath: "threads-and-state",
        frameworkDocsMode: "generated",
      }),
    ).toEqual({
      frontend: "teams",
      framework: "mastra",
      slugPath: "threads-and-state",
      sourceSlug: "channels/threads-and-state",
      canonicalPath: "/teams/mastra/threads-and-state",
    });
  });

  it("collapses an explicit built-in agent segment from the canonical path", () => {
    expect(
      resolveGuide({
        frontend: "teams",
        framework: "built-in-agent",
        slugPath: "threads-and-state",
      }),
    ).toEqual({
      frontend: "teams",
      framework: "built-in-agent",
      slugPath: "threads-and-state",
      sourceSlug: "channels/threads-and-state",
      canonicalPath: "/teams/threads-and-state",
    });
  });

  it("canonicalizes the overview at the provider root", () => {
    expect(resolveGuide({ slugPath: "overview" })).toEqual({
      frontend: "slack",
      framework: "built-in-agent",
      slugPath: "overview",
      sourceSlug: "channels",
      canonicalPath: "/slack",
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
