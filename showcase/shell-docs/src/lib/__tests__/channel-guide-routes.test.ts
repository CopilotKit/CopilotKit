import { describe, expect, it } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  DEFAULT_CHANNEL_FRAMEWORK,
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
  it("defines the supported frontends and implicit framework", () => {
    expect(CHANNEL_FRONTENDS).toEqual(["slack", "teams"]);
    expect(DEFAULT_CHANNEL_FRAMEWORK).toBe("built-in-agent");
  });

  it("keeps the public guide order and source metadata explicit", () => {
    expect(CHANNEL_GUIDE_ROUTES).toEqual([
      {
        slug: "overview",
        sourceSlug: "channels",
        navTitle: "Overview",
        section: "getting-started",
      },
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
        slug: "identity-and-memory",
        sourceSlug: "channels/identity-and-memory",
        navTitle: "Identity and Memory",
        section: "build",
      },
      {
        slug: "rich-messages",
        sourceSlug: "channels/rich-messages",
        navTitle: "Rich messages and components",
        section: "build",
      },
      {
        slug: "posting-jsx-as-images",
        sourceSlug: "channels/posting-jsx-as-images",
        navTitle: "Posting JSX as images",
        section: "build",
      },
      {
        slug: "render-and-carousel",
        sourceSlug: "channels/render-and-carousel",
        navTitle: "Render and carousel",
        section: "build",
      },
      {
        slug: "interactive",
        sourceSlug: "channels/interactive",
        navTitle: "Interactive messages and approvals",
        section: "build",
      },
      {
        slug: "commands-and-reactions",
        sourceSlug: "channels/commands-and-reactions",
        navTitle: "Commands and reactions",
        section: "build",
      },
      {
        slug: "files-and-multimodality",
        sourceSlug: "channels/files-and-multimodality",
        navTitle: "Files and multimodal input",
        section: "build",
      },
      {
        slug: "threads-and-state",
        sourceSlug: "channels/threads-and-state",
        navTitle: "Threads and state",
        section: "build",
      },
      {
        slug: "persistence-and-scaling",
        sourceSlug: "channels/persistence-and-scaling",
        navTitle: "Persistence and scaling",
        section: "production",
      },
      {
        slug: "history-and-transcripts",
        sourceSlug: "channels/history-and-transcripts",
        navTitle: "History and transcripts",
        section: "production",
      },
      {
        slug: "deploy-and-operate",
        sourceSlug: "channels/deploy-and-operate",
        navTitle: "Deploy and operate",
        section: "production",
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
