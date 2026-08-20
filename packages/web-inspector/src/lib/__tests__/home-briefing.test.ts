import { describe, expect, it } from "vitest";

import { projectInspectorMetadata } from "../inspector-metadata.js";
import {
  announcementPreview,
  buildHomeModel,
  homeHeroActionFromMetadata,
  splitAnnouncementMarkdown,
} from "../home-briefing.js";

describe("home-briefing", () => {
  it("splits announcement markdown into a featured story and later cards", () => {
    const stories = splitAnnouncementMarkdown(`## Channels
Try the new Channels demo.

## Angular
Angular docs are live.

## Release notes
Read the changelog.
`);
    expect(stories.map((story) => story.title)).toEqual([
      "Channels",
      "Angular",
      "Release notes",
    ]);
  });

  it("maps trusted metadata actions onto Home hero labels", () => {
    expect(
      homeHeroActionFromMetadata({
        kind: "enable_intelligence",
        url: "https://cloud.copilotkit.ai/actions/enable_intelligence",
      }).label,
    ).toBe("CONNECT TO INTELLIGENCE");
    expect(
      homeHeroActionFromMetadata({
        kind: "manage_plan",
        url: "https://cloud.copilotkit.ai/actions/manage_plan",
      }).label,
    ).toBe("MANAGE PLAN");
  });

  it("builds a disconnected hero and hides news when there is no announcement", () => {
    const model = buildHomeModel({
      firstOpen: true,
      unreadAnnouncement: false,
      connected: false,
      threadsAvailable: false,
      metadata: projectInspectorMetadata(undefined, undefined),
      agentNames: [],
      memoriesOn: false,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: false,
      audioOn: false,
    });
    expect(model.hero.title).toBe("Connect to Intelligence");
    expect(model.hero.connection).toBe("disconnected");
    expect(model.hero.action).toBeUndefined();
    expect(model.projectLinked).toBe(false);
    expect(model.news).toBeUndefined();
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
      firstOpen: false,
      unreadAnnouncement: false,
      connected: true,
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
      agentNames: ["tanstack"],
      memoriesOn: true,
      a2uiOn: false,
      openGenUiOn: false,
      suggestionsOn: true,
      audioOn: false,
    });
    expect(model.hero.connection).toBe("connected");
    expect(model.projectLinked).toBe(true);
    expect(model.project?.usage?.limitLabel).toBe("3 / 200");
    expect(model.hero.action?.label).toBe("MANAGE PLAN");
  });

  it("keeps announcement previews free of markdown noise", () => {
    expect(announcementPreview("## Hello\nRead [docs](https://x.test).")).toBe(
      "Hello Read docs.",
    );
  });
});
