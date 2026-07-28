import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildRootSurfaceNav, loadDoc, readTitle } from "../docs-render";
import type { NavNode } from "../docs-render";
import { filterFrontendScopedBlocks } from "../toc";

const maintainedChannelSlugs = [
  "channels",
  "channels/intelligence",
  "channels/tools",
  "channels/interactive",
  "channels/threads-and-state",
  "channels/reference/channel",
  "channels/reference/thread",
  "channels/reference/callbacks",
  "frontends/slack",
  "frontends/teams",
] as const;

const providerSensitiveSlugs = [
  "channels/intelligence",
  "channels/tools",
  "channels/interactive",
  "channels/threads-and-state",
  "channels/reference/channel",
  "channels/reference/callbacks",
] as const;

const providerQuickstartSlugs = ["frontends/slack", "frontends/teams"] as const;

function bodyFor(slug: (typeof maintainedChannelSlugs)[number]): string {
  const doc = loadDoc(slug);
  expect(doc, `missing maintained doc: ${slug}`).not.toBeNull();
  return doc!.source.replace(/^---[\s\S]*?---\n?/, "");
}

function navTitleFor(slug: (typeof maintainedChannelSlugs)[number]): string {
  const doc = loadDoc(slug);
  expect(doc, `missing maintained doc: ${slug}`).not.toBeNull();
  return readTitle(doc!.filePath) ?? "";
}

function fencedTypeScriptBlocks(source: string): string[] {
  return Array.from(
    source.matchAll(/```(?:ts|tsx)[^\n]*\n([\s\S]*?)```/g),
    (match) => match[1],
  );
}

function sectionIndex(nodes: NavNode[], title: string): number {
  return nodes.findIndex(
    (node) => node.type === "section" && node.title === title,
  );
}

describe("Channels documentation journey", () => {
  it("keeps the authored journey intentionally small", () => {
    const meta = JSON.parse(
      readFileSync(
        new URL("../../content/docs/channels/meta.json", import.meta.url),
        "utf8",
      ),
    ) as { pages: string[] };

    expect(meta.pages).toEqual(["index"]);
  });

  it("slots Channels into the root navigation before Deploy", () => {
    const nav = buildRootSurfaceNav("built-in-agent");
    const channelsIndex = sectionIndex(nav, "Channels");
    const deployIndex = sectionIndex(nav, "Deploy");

    expect(channelsIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(channelsIndex);
  });

  it("publishes only production-ready Slack and Teams setup routes", () => {
    const overview = loadDoc("channels");
    const slack = loadDoc("frontends/slack");
    const teams = loadDoc("frontends/teams");

    expect(overview?.source).toContain("Slack · Production ready");
    expect(overview?.source).toContain("Teams · Production ready");
    expect(overview?.source).toContain(
      "Discord, WhatsApp, GitHub, and Linear are coming soon",
    );
    expect(overview?.source).toContain(
      "insert Mike's final Channels architecture diagram here",
    );
    expect(slack?.fm.earlyAccess).toBeUndefined();
    expect(teams?.fm.earlyAccess).toBeUndefined();
    expect(loadDoc("frontends/whatsapp")).toBeNull();
  });

  it("pins the tested Channels SDK pair in both provider quickstarts", () => {
    const testedInstall =
      "npm install --save-exact @copilotkit/channels@0.3.0 @copilotkit/runtime@1.63.3-canary.rc-1";
    const nonExactInstall =
      "npm install @copilotkit/channels@0.3.0 @copilotkit/runtime@1.63.3-canary.rc-1";

    for (const slug of providerQuickstartSlugs) {
      const source = bodyFor(slug);

      expect(source, slug).toContain(testedInstall);
      expect(
        source,
        `${slug} allows npm to rewrite the tested versions`,
      ).not.toContain(nonExactInstall);
      expect(source, `${slug} has an unpinned Channels install`).not.toMatch(
        /npm install\s+@copilotkit\/channels(?!@)\b/,
      );
      expect(source, `${slug} has an unpinned runtime install`).not.toMatch(
        /npm install[^\n]*@copilotkit\/runtime(?!@)\b/,
      );
      expect(source, `${slug} uses a moving package tag`).not.toMatch(
        /@copilotkit\/(?:channels|runtime)@(?:latest|next)\b/,
      );
    }
  });

  it("requires Node.js 22 for the managed launcher in both quickstarts", () => {
    for (const slug of providerQuickstartSlugs) {
      const source = bodyFor(slug);

      expect(source, slug).toMatch(
        /Node\.js 22(?:\+| or later)[^\n]*global `?WebSocket`?/i,
      );
      expect(source, `${slug} retains stale Node 20 guidance`).not.toMatch(
        /Node(?:\.js)?\s+(?:v?\s*)?20(?:\.6)?(?:\+| or later)?/i,
      );
    }
  });

  it("matches the pinned Runtime URL and lifecycle contract", () => {
    for (const slug of providerQuickstartSlugs) {
      const source = bodyFor(slug);

      expect(source, slug).toContain(
        'apiUrl: required("INTELLIGENCE_API_URL")',
      );
      expect(source, slug).toContain(
        'wsUrl: required("INTELLIGENCE_GATEWAY_WS_URL")',
      );
      expect(source, slug).toContain("const channels = listener.channels");
      expect(source, slug).toMatch(/if \(!channels\)/);
      expect(source, slug).toContain(
        "await channels.ready({ timeoutMs: 30_000 })",
      );
      expect(source, slug).toContain('status.overall !== "online"');
      expect(source, slug).toMatch(/opens? no\s+connection/i);
      expect(source, slug).toMatch(/`ready\(\)` is required/i);
      expect(source, `${slug} bypasses the optional control guard`).not.toMatch(
        /listener\.channels\.(?:ready|status)\(/,
      );
      expect(
        source.indexOf('process.once("SIGTERM", shutdown)'),
        `${slug} registers shutdown before activation`,
      ).toBeLessThan(
        source.indexOf("await channels.ready({ timeoutMs: 30_000 })"),
      );
    }

    expect(
      bodyFor("channels/intelligence"),
      "Intelligence walkthrough bypasses the optional control guard",
    ).not.toMatch(/listener\.channels\.(?:ready|status)\(/);
  });

  it("treats the Intelligence REST and realtime endpoints as separate bases", () => {
    const source = bodyFor("channels/intelligence");

    expect(source).toMatch(/REST and realtime planes use separate hosts/i);
    expect(source).toMatch(/do not derive\s+the WebSocket URL/i);
    expect(source).toMatch(/Pass bare base URLs/i);
    expect(source).toMatch(
      /Do not append\s+`\/api`, `\/socket`, `\/runner`, or `\/client`/i,
    );
    expect(source).toMatch(/replace both bases together/i);
  });

  it("keeps the global Channels page overview-only", () => {
    const overview = bodyFor("channels");
    const cardHrefs = Array.from(
      overview.matchAll(/<Card\b[^>]*\bhref="([^"]+)"/g),
      (match) => match[1],
    );

    expect(cardHrefs).toEqual(["/slack", "/teams"]);
    expect(overview).not.toMatch(
      /href="\/channels\/(?:intelligence|tools|interactive|threads-and-state|reference)/,
    );
  });

  it("renders only the selected provider declaration in every shared guide", () => {
    for (const slug of providerSensitiveSlugs) {
      const source = bodyFor(slug);
      const slack = filterFrontendScopedBlocks(source, "slack");
      const teams = filterFrontendScopedBlocks(source, "teams");

      expect(slack, `${slug} Slack declaration`).toContain('provider: "slack"');
      expect(slack, `${slug} leaked Teams declaration`).not.toContain(
        'provider: "teams"',
      );
      expect(teams, `${slug} Teams declaration`).toContain('provider: "teams"');
      expect(teams, `${slug} leaked Slack declaration`).not.toContain(
        'provider: "slack"',
      );
    }
  });

  it("filters Intelligence setup and credentials to the selected provider", () => {
    const source = bodyFor("channels/intelligence");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(slack).toContain("### Connect Slack");
    expect(slack).toContain("connections:write");
    expect(slack).toContain("`xapp-…`");
    expect(slack).toContain("`xoxb-…`");
    expect(slack).toContain("`/invite @<app-handle>`");
    expect(slack).toContain("Socket Mode");
    expect(slack).toContain("public request URL");
    expect(slack).toContain("signing secret");
    expect(slack).not.toContain("### Connect Microsoft Teams");
    expect(slack).not.toContain("Directory (tenant) ID");

    expect(teams).toContain("### Connect Microsoft Teams");
    expect(teams).toContain("Microsoft Entra");
    expect(teams).toContain("Azure Bot");
    expect(teams).toContain("Messaging endpoint");
    expect(teams).toContain("Microsoft Teams");
    expect(teams).toContain("Download app package (.zip)");
    expect(teams).not.toContain("### Connect Slack");
    expect(teams).not.toContain("connections:write");
    expect(teams).not.toContain("`xapp-…`");
    expect(teams).not.toContain("`xoxb-…`");

    for (const filtered of [slack, teams]) {
      expect(filtered).toContain("**Name & platforms**");
      expect(filtered).toContain("**Setup**");
      expect(filtered).toContain("**Review**");
      expect(filtered).toContain("**Setup incomplete**");
      expect(filtered).toContain("**Online**");
    }
  });

  it("distinguishes Intelligence platform selection from runnable topology", () => {
    const source = bodyFor("channels/intelligence");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(source).toMatch(
      /Intelligence UI can store and configure\s+multiple selected platforms/i,
    );
    expect(source).toMatch(/one provider per\s+`createChannel` declaration/i);
    expect(source).toMatch(/one Channel per gateway session/i);
    expect(source).toMatch(/one Intelligence Channel per provider/i);
    expect(source).toMatch(/unique Codes/i);
    expect(source).toMatch(/one declaration and gateway session per Code/i);
    expect(source).toMatch(/same agent backend/i);
    expect(source).not.toMatch(
      /(?:cannot|does not) (?:select|support) multiple/i,
    );

    expect(slack).toMatch(/select and configure only Slack/i);
    expect(slack).toContain('name: "support-slack"');
    expect(teams).toMatch(/select and configure only Microsoft Teams/i);
    expect(teams).toContain('name: "support-teams"');
  });

  it("hands off from the wizard to the pinned provider quickstart", () => {
    const source = bodyFor("channels/intelligence");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(source).not.toMatch(/copy the snippet if useful/i);
    expect(source).not.toContain('from "@copilotkit/channel"');
    expect(source).toMatch(
      /runtime snippet[\s\S]{0,240}Channel Code[\s\S]{0,120}configuration reference/i,
    );
    expect(source).toContain("### Configure the runtime handoff");
    expect(source).not.toContain("### Copy the runtime handoff");

    expect(slack).toMatch(/pinned Slack quickstart's provider\s+runner/i);
    expect(slack).toContain("[Slack quickstart](/slack)");
    expect(teams).toMatch(/pinned Teams quickstart's provider\s+runner/i);
    expect(teams).toContain("[Teams quickstart](/teams)");
  });

  it("keeps required environment reads self-contained in provider snippets", () => {
    for (const slug of [
      "channels/tools",
      "channels/interactive",
      "channels/threads-and-state",
      "channels/reference/callbacks",
    ] as const) {
      for (const frontend of ["slack", "teams"] as const) {
        const blocks = fencedTypeScriptBlocks(
          filterFrontendScopedBlocks(bodyFor(slug), frontend),
        ).filter((block) => block.includes("createChannel({"));

        expect(blocks.length, `${slug} ${frontend} createChannel blocks`).toBe(
          slug === "channels/tools" ? 2 : 1,
        );
        for (const block of blocks) {
          expect(block, `${slug} ${frontend} required helper`).toContain(
            "function required(name: string): string",
          );
          expect(block).toContain('required("CHANNEL_CODE")');
        }
      }
    }
  });

  it("documents native interaction behavior without changing shared APIs", () => {
    const source = bodyFor("channels/interactive");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(slack).toContain("Block Kit");
    expect(slack).toContain("block_actions");
    expect(slack).toContain("Socket Mode");
    expect(slack).toContain("Interactivity");
    expect(slack).toMatch(/generated manifest[\s\S]{0,160}disabled/i);

    expect(teams).toContain("Adaptive Cards");
    expect(teams).toContain("Action.Submit");
    expect(teams).toMatch(/message\s+activities/);

    for (const filtered of [slack, teams]) {
      expect(filtered).toContain("thread.resume(value)");
      expect(filtered).toContain("](/human-in-the-loop)");
    }
  });

  it("resumes approvals even when the interaction message cannot be updated", () => {
    for (const slug of [
      "channels/interactive",
      "channels/reference/callbacks",
    ] as const) {
      const source = bodyFor(slug);
      const updates = Array.from(source.matchAll(/await thread\.update\(/g));
      const resumes = Array.from(
        source.matchAll(/await thread\.resume\(value\);/g),
      );

      expect(updates.length, `${slug} update examples`).toBeGreaterThan(0);
      expect(resumes.length, `${slug} matching resume examples`).toBe(
        updates.length,
      );
      expect(source, `${slug} updateable-ref guidance`).toMatch(
        /`message\.ref\.id`[\s\S]{0,240}(?:non-empty|interaction carries)/i,
      );

      for (const update of updates) {
        const updateIndex = update.index;
        const guardIndex = source.lastIndexOf(
          "if (message.ref.id) {",
          updateIndex,
        );
        const previousResumeIndex = source.lastIndexOf(
          "await thread.resume(value);",
          updateIndex,
        );
        const catchIndex = source.indexOf("} catch {", updateIndex);
        const resumeIndex = source.indexOf(
          "await thread.resume(value);",
          updateIndex,
        );

        expect(guardIndex, `${slug} guards message update`).toBeGreaterThan(
          previousResumeIndex,
        );
        expect(
          catchIndex,
          `${slug} treats update as best-effort`,
        ).toBeGreaterThan(updateIndex);
        expect(catchIndex, `${slug} catches update before resume`).toBeLessThan(
          resumeIndex,
        );
      }
    }

    const teamsInteractive = filterFrontendScopedBlocks(
      bodyFor("channels/interactive"),
      "teams",
    );
    const teamsCallbacks = filterFrontendScopedBlocks(
      bodyFor("channels/reference/callbacks"),
      "teams",
    );

    for (const source of [teamsInteractive, teamsCallbacks]) {
      expect(source).toMatch(
        /Teams[\s\S]{0,240}`Action\.Submit`[\s\S]{0,320}(?:omit|without)[\s\S]{0,120}(?:message ref|`message\.ref\.id`)/i,
      );
    }
  });

  it("limits managed message refs to the delivery that stamped them", () => {
    const source = bodyFor("channels/reference/thread");

    expect(source).toMatch(
      /`MessageRef` returned by `thread\.post\(\)`[\s\S]{0,160}only\s+during the current managed delivery/i,
    );
    expect(source).toMatch(
      /Do not persist arbitrary refs[\s\S]{0,160}across deliveries/i,
    );
    expect(source).toMatch(
      /later interaction[\s\S]{0,160}`message\.ref`[\s\S]{0,160}stamps for that delivery/i,
    );
    expect(source).toMatch(
      /`message\.ref\.id`[\s\S]{0,120}non-empty[\s\S]{0,160}best-effort/i,
    );
    expect(source).not.toMatch(
      /(?:MessageRefs?|message refs?)[^.\n]{0,120}(?:can|may|are) (?:always )?(?:be )?(?:updated|deleted)[^.\n]{0,120}(?:later|across deliveries)/i,
    );
  });

  it("keeps shared managed identity and state guidance in both variants", () => {
    const tools = bodyFor("channels/tools");
    const threads = bodyFor("channels/threads-and-state");

    for (const frontend of ["slack", "teams"] as const) {
      const filteredTools = filterFrontendScopedBlocks(tools, frontend);
      const filteredThreads = filterFrontendScopedBlocks(threads, frontend);

      expect(filteredTools).toContain("`message.platform`");
      expect(filteredTools).toContain("`thread.platform`");
      expect(filteredTools).toContain("`ctx.platform`");
      expect(filteredTools).toContain('"intelligence"');
      expect(filteredThreads).toContain("`thread.conversationKey`");
      expect(filteredThreads).toMatch(/conversationKey[\s\S]{0,120}opaque/i);
      expect(filteredThreads).toContain("durable `StateStore`");
    }
  });

  it("uses the guide labels selected for Slack and Teams navigation", () => {
    expect(navTitleFor("channels/intelligence")).toBe(
      "Configure the Channel in Intelligence",
    );
    expect(navTitleFor("channels/interactive")).toBe(
      "Interactive messages and approvals",
    );
    expect(navTitleFor("channels/reference/channel")).toBe("Channel");
    expect(navTitleFor("channels/reference/thread")).toBe("Thread");
    expect(navTitleFor("channels/reference/callbacks")).toBe("JSX callbacks");
  });

  it("uses the managed createChannel API throughout maintained pages", () => {
    const combinedSource = maintainedChannelSlugs
      .map((slug) => {
        const doc = loadDoc(slug);
        expect(doc, `missing maintained doc: ${slug}`).not.toBeNull();
        return doc!.source;
      })
      .join("\n");

    expect(combinedSource).toContain("createChannel");
    expect(combinedSource).not.toMatch(
      /\bcreateBot\s*\(|\bdefineBotTool\b|\bCopilotSseRuntime\b|@copilotkit\/channels-ui/i,
    );
    expect(combinedSource).not.toMatch(
      /(?:Slack|Teams)[^\n]{0,60}early access|early access[^\n]{0,60}(?:Slack|Teams)/i,
    );
    const proseWithoutTestedRuntimePin = combinedSource.replaceAll(
      "@copilotkit/runtime@1.63.3-canary.rc-1",
      "",
    );
    expect(proseWithoutTestedRuntimePin).not.toMatch(
      /\bcanary\b|coordinated launch|launch version|managed launch path/i,
    );
  });

  it("retains no duplicate authored pages behind retired routes", () => {
    for (const slug of [
      "channels/quickstart",
      "channels/ui-library",
      "channels/persistence",
      "channels/platforms/slack",
      "channels/platforms/teams",
      "channels/interactive/human-in-the-loop",
    ]) {
      expect(loadDoc(slug), `retired doc still exists: ${slug}`).toBeNull();
    }
  });
});
