import { describe, expect, it } from "vitest";

import { projectInspectorMetadata } from "../inspector-metadata.js";
import {
  announcementPreview,
  buildHomeModel,
  homeFeatureImplementationPrompt,
  homeHeroActionFromMetadata,
  runtimeConnectionNeedsAttention,
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
    expect(model.hero.title).toBe("CopilotKit Intelligence");
    // In install mode this body is the screen-reader summary, not the visible
    // paragraph, so it has to carry the whole chain in one sentence. If a link
    // in that chain drops out, assistive tech gets a weaker pitch than sighted
    // users and nothing else in the suite would notice.
    expect(model.hero.body).toContain("thread");
    expect(model.hero.body).toContain("evidence");
    expect(model.hero.body).toContain("skills");
    // The approval step is the one claim we must not quietly drop: the
    // platform does not apply skills at run time, and promising that it does
    // is a promise the product cannot keep.
    expect(model.hero.body).toContain("approve");
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
    const learning = model.services.find((service) => service.id === "memory");
    const suggestions = model.services.find(
      (service) => service.id === "suggestions",
    );
    const voice = model.services.find((service) => service.id === "audio");
    expect(learning).toMatchObject({ label: "Learning" });
    expect(voice).toMatchObject({ label: "Voice" });
    expect(suggestions).toMatchObject({
      docsUrl:
        "https://docs.copilotkit.ai/reference/hooks/useConfigureSuggestions",
    });
    expect(
      homeFeatureImplementationPrompt(learning!, {
        onboardingRunId: "21bcf98aa5fd",
      }),
    )
      .toBe(`Identify your coding-agent slug (for example, \`codex\` or \`claude-code\`). From the target project root, run \`npx copilotkit@latest onboard start --run 21bcf98aa5fd --coding-agent <coding-agent-slug>\` and use its output as onboarding context. If it requires a CopilotKit CLI session check, you have permission to run it; never reveal credentials or send optional diagnostic feedback reports.

This task is specifically to enable Learning, not to re-onboard the application. First inspect the existing CopilotKit runtime, provider, agent, and UI wiring, and confirm that Learning is not already enabled. Then read the Learning guide (https://docs.copilotkit.ai/intelligence/intelligence-platform) and make a short plan before editing. Preserve the project's framework, package manager, installed CopilotKit version, existing agent IDs, routes, provider layout, and working behavior. Do not create, select, or alter a CopilotKit Intelligence project—or add Intelligence configuration—unless this feature's official guide explicitly requires it or the user asks.

Implement the smallest complete integration: wire every feature-required client and runtime configuration into the chat-to-agent path people already use, reuse local patterns, and do not invent environment values or hardcode secrets. Add or update focused tests and run the relevant project checks. Finish only after local validation proves Learning works—not merely that the code compiles. Use a feature-specific runtime or Inspector capability check and, when the feature supports one, a representative UI interaction that proves the user-facing result. If the project overrides default rendering (for example, with a wildcard tool renderer), make that override compatible with this feature; a capability flag alone is not success. Summarize the changed files, validation, and any manual setup still required.`);
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
  // The launcher's error signal and System Health read this one predicate, so
  // the dot is red exactly when System Health says the runtime needs
  // attention. A second evaluation anywhere could drift from it.
  it("treats only the error connection state as needing attention", () => {
    expect(runtimeConnectionNeedsAttention("error")).toBe(true);
    // `disconnected` is also the INITIAL value, so counting it would raise the
    // signal on every page load; `connecting` is a normal startup step; and
    // `unavailable` means no Core is attached, which is not a wiring defect.
    expect(runtimeConnectionNeedsAttention("disconnected")).toBe(false);
    expect(runtimeConnectionNeedsAttention("connecting")).toBe(false);
    expect(runtimeConnectionNeedsAttention("unavailable")).toBe(false);
    expect(runtimeConnectionNeedsAttention("connected")).toBe(false);
  });

  it("keeps the predicate and the built health model in agreement", () => {
    const base = {
      intelligenceConnected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    } as const;

    for (const state of [
      "connected",
      "connecting",
      "disconnected",
      "error",
      "unavailable",
    ] as const) {
      const model = buildHomeModel({ ...base, runtimeConnectionState: state });
      expect(
        model.runtime.health.state === "error",
        `${state}: connection health`,
      ).toBe(runtimeConnectionNeedsAttention(state));
    }
  });

  // A failed RUN also drives System Health to "Needs attention", and must NOT
  // reach the launcher: an event does not belong on a state indicator. The
  // predicate is the boundary that keeps the two apart.
  it("separates a failed run from a broken connection", () => {
    const model = buildHomeModel({
      intelligenceConnected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      runtimeConnectionState: "connected",
      lastRuntimeEvent: {
        id: "support:2",
        agentId: "support",
        type: "RUN_ERROR",
        timestamp: 2_000,
      },
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    });
    expect(model.runtime.health.state).toBe("error");
    expect(runtimeConnectionNeedsAttention("connected")).toBe(false);
  });
});
