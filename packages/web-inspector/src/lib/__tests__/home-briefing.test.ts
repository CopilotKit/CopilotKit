import { describe, expect, it } from "vitest";

import { projectInspectorMetadata } from "../inspector-metadata.js";
import {
  announcementPreview,
  buildHomeModel,
  homeHeroActionFromMetadata,
} from "../home-briefing.js";

describe("home-briefing", () => {
  it("maps trusted metadata actions onto Home hero labels", () => {
    expect(
      homeHeroActionFromMetadata({
        kind: "enable_intelligence",
        url: "https://cloud.copilotkit.ai/actions/enable_intelligence",
      }).label,
    ).toBe("Setup Intelligence");
    expect(
      homeHeroActionFromMetadata({
        kind: "manage_plan",
        url: "https://cloud.copilotkit.ai/actions/manage_plan",
      }).label,
    ).toBe("Manage plan");
  });

  it("builds a disconnected hero and an empty news state when there is no announcement", () => {
    const model = buildHomeModel({
      intelligenceConnected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      runtimeConnectionState: "unavailable",
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    });
    expect(model.hero.title).toBe("Intelligence is not setup");
    expect(model.hero.connection).toBe("disconnected");
    expect(model.hero.action).toBeUndefined();
    expect(model.projectLinked).toBe(false);
    expect(model.news).toMatchObject({
      empty: true,
      title: "You're all caught up",
    });
    expect(model.services.map((service) => service.id)).toEqual([
      "threads",
      "memory",
      "a2ui",
      "open-gen-ui",
      "suggestions",
      "audio",
      "websocket",
    ]);
  });

  it("marks a linked project as connected and keeps Threads usage on the project card", () => {
    const model = buildHomeModel({
      intelligenceConnected: true,
      threadsAvailable: true,
      metadata: projectInspectorMetadata(
        {
          schemaVersion: 1,
          identity: {
            organizationName: "Acme Inc.",
            projectName: "Support",
          },
          plan: { code: "free", label: "Free" },
          license: { state: "valid" },
          action: {
            kind: "manage_plan",
            url: "https://cloud.copilotkit.ai/actions/manage_plan",
          },
          usage: {
            used: 3,
            limit: { kind: "finite", value: 200 },
          },
        },
        "valid",
      ),
      runtimeConnectionState: "connected",
      memoriesOn: true,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: true,
      audioOn: false,
    });
    expect(model.hero.connection).toBe("connected");
    expect(model.projectLinked).toBe(true);
    expect(model.project?.usage?.limitLabel).toBe("3 / 200");
    expect(model.hero.action?.label).toBe("Manage plan");
  });

  it("does not mistake project identity for an Intelligence connection", () => {
    const model = buildHomeModel({
      intelligenceConnected: true,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(
        {
          schemaVersion: 1,
          identity: {
            organizationName: "Acme Inc.",
            projectName: "Support",
          },
          license: { state: "none" },
          action: {
            kind: "enable_intelligence",
            url: "https://cloud.copilotkit.ai/actions/enable_intelligence",
          },
        },
        "none",
      ),
      runtimeConnectionState: "connected",
      memoriesOn: true,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
      websocketUrl: "wss://cloud.copilotkit.ai/runtime",
    });

    expect(model.projectLinked).toBe(true);
    expect(model.hero.connection).toBe("disconnected");
    expect(model.hero.action?.kind).toBe("enable_intelligence");
    expect(
      model.services.find((service) => service.id === "threads")?.enabled,
    ).toBe(false);
    expect(
      model.services.find((service) => service.id === "memory")?.enabled,
    ).toBe(false);
    expect(
      model.services.find((service) => service.id === "websocket")?.enabled,
    ).toBe(false);
  });

  it("does not present an expired Intelligence license as connected", () => {
    const model = buildHomeModel({
      intelligenceConnected: true,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(
        {
          schemaVersion: 1,
          license: { state: "expired" },
          action: {
            kind: "renew",
            url: "https://cloud.copilotkit.ai/actions/renew",
          },
        },
        "expired",
      ),
      runtimeConnectionState: "connected",
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
      intelligenceSignupUrl: "https://intelligence.copilotkit.ai",
    });

    expect(model.hero.connection).toBe("disconnected");
    expect(model.hero.action?.kind).toBe("renew");
  });

  it("keeps usage-only metadata visible on the project card", () => {
    const model = buildHomeModel({
      intelligenceConnected: true,
      threadsAvailable: true,
      metadata: projectInspectorMetadata(
        {
          schemaVersion: 1,
          license: { state: "valid" },
          usage: {
            used: 4,
            limit: { kind: "finite", value: 200 },
          },
        },
        "valid",
      ),
      runtimeConnectionState: "connected",
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    });

    expect(model.projectLinked).toBe(false);
    expect(model.project?.usage?.limitLabel).toBe("4 / 200");
  });

  it("keeps announcement previews free of markdown noise", () => {
    expect(announcementPreview("## Hello\nRead [docs](https://x.test).")).toBe(
      "Hello Read docs.",
    );
  });

  it("uses the CDN preview text and keeps its announcement document intact", () => {
    const model = buildHomeModel({
      intelligenceConnected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      runtimeConnectionState: "unavailable",
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
      announcementPreviewText: "Channels and Angular are live.",
      announcementMarkdown: "## Now live: Channels\nRead the full update.",
      announcementHtml:
        "<h2>Now live: Channels</h2><p>Read the full update.</p>",
    });

    expect(model.news).toEqual({
      title: "Now live: Channels",
      previewText: "Channels and Angular are live.",
      documentHtml: "<h2>Now live: Channels</h2><p>Read the full update.</p>",
      empty: false,
    });
  });

  it("summarizes runtime connection, response, and newest event health", () => {
    const base = {
      intelligenceConnected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      runtimeUrl: "http://localhost:4000/api/copilotkit",
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    };

    const success = buildHomeModel({
      ...base,
      runtimeConnectionState: "connected",
      lastRuntimeEvent: {
        id: "support:1",
        agentId: "support",
        type: "RUN_FINISHED",
        timestamp: 1_000,
      },
    });
    expect(success.runtime.health).toMatchObject({
      state: "healthy",
      label: "Healthy",
      runtime: { label: "Available", tone: "success" },
      liveUpdates: { label: "Ready", tone: "success" },
      lastEvent: {
        label: "Run completed",
        tone: "success",
        id: "support:1",
        agentId: "support",
        type: "RUN_FINISHED",
      },
    });

    const eventError = buildHomeModel({
      ...base,
      runtimeConnectionState: "connected",
      lastRuntimeEvent: {
        id: "support:2",
        agentId: "support",
        type: "RUN_ERROR",
        timestamp: 2_000,
      },
    });
    expect(eventError.runtime.health).toMatchObject({
      state: "error",
      label: "Needs attention",
      runtime: { label: "Available", tone: "success" },
      liveUpdates: { label: "Ready", tone: "success" },
      lastEvent: {
        label: "Run error",
        tone: "error",
        id: "support:2",
        agentId: "support",
        type: "RUN_ERROR",
      },
    });

    const disconnected = buildHomeModel({
      ...base,
      runtimeConnectionState: "disconnected",
    });
    expect(disconnected.runtime.health).toMatchObject({
      state: "offline",
      label: "Offline",
      runtime: { label: "Offline", tone: "error" },
      liveUpdates: { label: "Disconnected", tone: "error" },
      lastEvent: { label: "No events yet", tone: "muted" },
    });
  });
});
