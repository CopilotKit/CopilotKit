import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildRootSurfaceNav, loadDoc, readTitle } from "../docs-render";
import type { NavNode } from "../docs-render";
import { filterFrontendScopedBlocks } from "../toc";

const maintainedChannelSlugs = [
  "channels",
  "channels/intelligence",
  "channels/tools",
  "channels/rich-messages",
  "channels/interactive",
  "channels/commands-and-reactions",
  "channels/files-and-multimodality",
  "channels/threads-and-state",
  "channels/persistence-and-scaling",
  "channels/history-and-transcripts",
  "channels/deploy-and-operate",
  "frontends/slack",
  "frontends/teams",
] as const;

const providerSensitiveSlugs = [
  "channels/intelligence",
  "channels/tools",
  "channels/interactive",
  "channels/commands-and-reactions",
  "channels/threads-and-state",
  "channels/persistence-and-scaling",
  "channels/history-and-transcripts",
] as const;

const providerQuickstartSlugs = ["frontends/slack", "frontends/teams"] as const;
const channelReferenceFiles = {
  channel: "../../content/reference/channels/classes/Channel.mdx",
  thread: "../../content/reference/channels/classes/Thread.mdx",
  callbacks: "../../content/reference/channels/types/JSXCallbacks.mdx",
  directAdapters: "../../content/reference/channels/sdk/direct-adapters.mdx",
  index: "../../content/reference/channels/index.mdx",
} as const;

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

function referenceBodyFor(key: keyof typeof channelReferenceFiles): string {
  return readFileSync(
    new URL(channelReferenceFiles[key], import.meta.url),
    "utf8",
  ).replace(/^---[\s\S]*?---\n?/, "");
}

function referenceTitleFor(key: keyof typeof channelReferenceFiles): string {
  const source = readFileSync(
    new URL(channelReferenceFiles[key], import.meta.url),
    "utf8",
  );
  return source.match(/^title:\s*(.+)$/m)?.[1] ?? "";
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
  it("publishes the Channels overview only through provider navigation", () => {
    const nav = buildRootSurfaceNav("built-in-agent");
    const channelsIndex = sectionIndex(nav, "Channels");
    const overview = loadDoc("channels");

    expect(channelsIndex).toBe(-1);
    expect(overview).not.toBeNull();
    expect(overview?.source).toContain(
      'src="/images/channels/channels-architecture-light.png"',
    );
    expect(overview?.source).toContain(
      'src="/images/channels/channels-architecture-dark.png"',
    );
    expect(overview?.source).not.toContain(
      'src="/images/slack-bot-generative-ui-light.png"',
    );
    expect(overview?.source).not.toContain('title="Build for Slack"');
    expect(overview?.source).not.toContain(
      "Discord and WhatsApp support is coming soon.",
    );
    expect(overview?.source).not.toContain(
      "## Match your Channels configuration",
    );
    expect(overview?.source).toContain(
      "description: Run one AG-UI agent in Slack, Microsoft Teams, and more",
    );
    expect(overview?.source).toContain(
      "channel connection (Slack, Teams, Discord, etc.)",
    );
    expect(overview?.source).toContain('title="More channels are on the way"');
    expect(overview?.source).toContain(
      'surface="docs_channels_more_channels_contact"',
    );
    expect(overview?.source).toContain('ctaLabel="Book time with an engineer"');
    expect(overview?.source).toContain(
      "## Production self-hosting: Run Enterprise Intelligence in your own infrastructure",
    );
    expect(overview?.source).toContain(
      'surface="docs_channels_self_hosting_contact"',
    );
    expect(overview?.source).toContain(
      ">Book time with a CopilotKit engineer</DocsTrackedLink>",
    );
    expect(overview?.source).toContain("## Next step");
    expect(overview?.source).toContain(
      "[Configure the Channel in Intelligence](/channels/intelligence)",
    );
    expect(overview?.source).not.toContain("[Slack quickstart](/slack)");
    expect(overview?.source).not.toContain(
      "[Microsoft Teams quickstart](/teams)",
    );
    expect(overview?.source).not.toContain('<Callout type="info" title="Next:');
  });

  it("publishes only Slack and Teams setup routes", () => {
    const slack = loadDoc("frontends/slack");
    const teams = loadDoc("frontends/teams");

    expect(slack).not.toBeNull();
    expect(teams).not.toBeNull();
    expect(slack?.fm.title).toBe("Connect and run your agent in Slack");
    expect(teams?.fm.title).toBe(
      "Connect and run your agent in Microsoft Teams",
    );
    expect(slack?.fm.earlyAccess).toBeUndefined();
    expect(teams?.fm.earlyAccess).toBeUndefined();
    for (const doc of [slack, teams]) {
      expect(doc?.source).not.toContain(
        "Managed Intelligence support for Discord and WhatsApp is coming soon.",
      );
      expect(doc?.source).not.toContain("production-ready");
      expect(doc?.source).not.toContain("<OpsPlatformCTA");
      expect(doc?.source).not.toContain(
        'title="Run a persistent realtime listener"',
      );
      expect(doc?.source).toContain(
        "The install command below uses an exact, tested SDK pair",
      );
      expect(doc?.source).toContain("`CHANNEL_CODE`");
      expect(doc?.source).toContain("`INTELLIGENCE_API_KEY`");
      expect(doc?.source).toContain("## Before you start");
      expect(doc?.source).toContain("## Build and run your Channel");
      expect(doc?.source).toContain("## Troubleshooting");
      for (const status of [
        "**Disabled**",
        "**Setup incomplete**",
        "**Setup failed**",
        "**Waiting for runtime**",
        "**Conflict**",
        "**Offline**",
        "**Delivery failing**",
        "**Online**",
      ]) {
        expect(doc?.source).toContain(status);
      }
    }
    expect(bodyFor("channels/intelligence")).toContain("<OpsPlatformCTA");
    expect(loadDoc("frontends/whatsapp")).toBeNull();
  });

  it("installs the exact stable Channels SDK pair in both provider quickstarts", () => {
    const testedInstall =
      "npm install --save-exact @copilotkit/channels@0.5.0 @copilotkit/runtime@1.64.2";
    const nonExactInstall =
      "npm install @copilotkit/channels@0.5.0 @copilotkit/runtime@1.64.2";

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

  it("matches the Runtime URL and lifecycle contract", () => {
    for (const slug of providerQuickstartSlugs) {
      const source = bodyFor(slug);

      expect(source, slug).toContain(
        "apiUrl: process.env.INTELLIGENCE_API_URL",
      );
      expect(source, slug).toContain(
        "wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL",
      );
      expect(source, slug).toMatch(
        /hosted Intelligence supplies both managed base URLs by default/i,
      );
      expect(source, slug).not.toContain('required("INTELLIGENCE_API_URL")');
      expect(source, slug).not.toContain(
        'required("INTELLIGENCE_GATEWAY_WS_URL")',
      );
      expect(source, slug).toContain("const channels = listener.channels");
      expect(source, slug).not.toMatch(/if \(!channels\)/);
      expect(source, slug).toContain(
        "await channels.ready({ timeoutMs: 30_000 })",
      );
      expect(source, slug).toContain('status.overall !== "online"');
      expect(source, slug).toMatch(
        /Creating the Node listener starts the Channel/i,
      );
      expect(source, slug).toMatch(/`ready\(\)`\s+is therefore optional/i);
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

    expect(source).toMatch(/REST and realtime planes\s+use\s+separate hosts/i);
    expect(source).toMatch(/do not derive\s+the WebSocket URL/i);
    expect(source).toMatch(/Pass bare base URLs/i);
    expect(source).toMatch(
      /Do not append\s+`\/api`,\s+`\/socket`,\s+`\/runner`,\s+`\/client`,\s+or\s+`\/channels`/i,
    );
    expect(source).toMatch(/replace both(?: bases)?\s+together/i);
  });

  it("publishes the Channels API under Reference instead of provider guides", () => {
    const index = referenceBodyFor("index");

    expect(index).toContain("/reference/channels/classes/Channel");
    expect(index).toContain("/reference/channels/classes/Thread");
    expect(index).toContain("/reference/channels/types/JSXCallbacks");
    expect(index).toContain("/reference/channels/functions/createChannel");
    expect(index).toContain("/reference/channels/components/Button");
    expect(index).toContain("/reference/channels/types/StateStore");
    expect(index).toContain("/reference/channels/sdk/direct-adapters");
    expect(index).toContain(
      "[Connect and run your agent in Slack](/slack/connect)",
    );
    expect(index).toContain(
      "[Connect and run your agent in Microsoft Teams](/teams/connect)",
    );

    const directAdapters = referenceBodyFor("directAdapters");
    for (const provider of [
      "@copilotkit/channels/slack",
      "@copilotkit/channels/teams",
      "@copilotkit/channels/discord",
      "@copilotkit/channels/telegram",
      "@copilotkit/channels/whatsapp",
    ]) {
      expect(directAdapters).toContain(provider);
    }
    expect(directAdapters).toMatch(/Direct does not mean standalone/i);
    expect(directAdapters).toMatch(
      /Managed Intelligence support for Discord and WhatsApp is coming soon/i,
    );
    expect(directAdapters).toMatch(/does not traverse the managed Realtime/i);
    expect(directAdapters).toContain("ESM-only");
    expect(directAdapters).toContain("Message Content Intent");
    expect(directAdapters).toContain("Server Members Intent");
  });

  it("keeps managed provider selection out of shared SDK declarations", () => {
    for (const slug of providerSensitiveSlugs) {
      const source = bodyFor(slug);
      const slack = filterFrontendScopedBlocks(source, "slack");
      const teams = filterFrontendScopedBlocks(source, "teams");

      for (const filtered of [slack, teams]) {
        expect(filtered, `${slug} leaked Slack SDK declaration`).not.toContain(
          'provider: "slack"',
        );
        expect(filtered, `${slug} leaked Teams SDK declaration`).not.toContain(
          'provider: "teams"',
        );
      }
    }
  });

  it("filters Intelligence setup and credentials to the selected provider", () => {
    const source = bodyFor("channels/intelligence");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(slack).toContain("### Connect Slack");
    expect(slack).toContain("`xoxb-…`");
    expect(slack).toContain("`/invite @<app-handle>`");
    expect(slack).toContain("Signing Secret");
    expect(slack).toContain("signed Events API");
    expect(slack).toMatch(/public\s+Intelligence URL/);
    expect(slack).not.toContain("Socket Mode");
    expect(slack).not.toContain("### Connect Microsoft Teams");
    expect(slack).not.toContain("Directory (tenant) ID");

    expect(teams).toContain("### Connect Microsoft Teams");
    expect(teams).toContain("Microsoft Entra");
    expect(teams).toContain("Azure Bot");
    expect(teams).toContain("Fast CLI setup (recommended)");
    expect(teams).toContain("Guided manual setup");
    expect(teams).toMatch(/Teams\s+Developer Portal/);
    expect(teams).toContain("never stores them");
    expect(teams).toContain("Add to a team");
    expect(teams).toContain("Microsoft Teams");
    expect(teams).toContain("fresh package");
    expect(teams).not.toContain("### Connect Slack");
    expect(teams).not.toContain("connections:write");
    expect(teams).not.toContain("`xapp-…`");
    expect(teams).not.toContain("`xoxb-…`");

    for (const filtered of [slack, teams]) {
      expect(filtered).toContain("**Name & platforms**");
      expect(filtered).toContain("**Setup**");
      expect(filtered).toContain("**Review**");
    }
  });

  it("distinguishes Intelligence platform selection from runnable topology", () => {
    const source = bodyFor("channels/intelligence");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(source).toMatch(/One Channel can serve both providers/i);
    expect(source).toMatch(/one Code and one SDK handler set/i);
    expect(source).toMatch(/Select Slack, Microsoft Teams, or both/i);
    expect(source).not.toMatch(/separate Intelligence Channel/i);
    expect(source).not.toMatch(
      /current managed SDK activation|runtime ownership|gateway session/i,
    );

    expect(slack).toMatch(/Configure Slack for this guide/i);
    expect(slack).toMatch(/attach Teams to the same Channel/i);
    expect(slack).toContain('name: "support"');
    expect(teams).toMatch(/Configure Microsoft Teams for this guide/i);
    expect(teams).toMatch(/attach Slack to the same\s+Channel/i);
    expect(teams).toContain('name: "support"');
  });

  it("hands off from Intelligence to the provider runtime guide", () => {
    const source = bodyFor("channels/intelligence");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(source).not.toMatch(
      /Do not copy|runtime snippet|Copy snippet|configuration reference/i,
    );
    expect(source).not.toContain('from "@copilotkit/channel"');
    expect(source).toContain("### Configure the runtime handoff");
    expect(source).not.toContain("### Copy the runtime handoff");

    expect(slack).toContain("Your Slack Channel should now be");
    expect(slack).toContain("[Connect and run your agent](/slack/connect)");
    expect(teams).toContain("Your Microsoft Teams Channel should now be");
    expect(teams).toContain("[Connect and run your agent](/teams/connect)");
    for (const filtered of [slack, teams]) {
      expect(filtered).toContain("**Waiting for runtime**");
      expect(filtered).toContain("`CHANNEL_CODE`");
      expect(filtered).toContain("`INTELLIGENCE_API_KEY`");
    }
  });

  it("shows the Intelligence Channels area before the setup steps", () => {
    const source = bodyFor("channels/intelligence");
    const setupHeadingIndex = source.indexOf(
      "## Create and configure your Channel",
    );
    const imageIndex = source.indexOf(
      'src="/images/channels/intelligence-channels-overview.png"',
    );
    const stepsIndex = source.indexOf("<Steps>");

    expect(source).not.toContain(
      'src="/images/channels/channels-architecture-light.png"',
    );
    expect(source).not.toContain(
      'src="/images/channels/channels-architecture-dark.png"',
    );
    expect(setupHeadingIndex).toBeGreaterThan(-1);
    expect(setupHeadingIndex).toBeLessThan(imageIndex);
    expect(imageIndex).toBeGreaterThan(-1);
    expect(imageIndex).toBeLessThan(stepsIndex);
    expect(source).toContain("## Next step");
    expect(source).toMatch(
      /alt="[^"]*Intelligence[^"]*channel creation[^"]*Slack[^"]*Teams[^"]*"/i,
    );
  });

  it("keeps required environment reads self-contained in provider snippets", () => {
    for (const slug of [
      "channels/tools",
      "channels/interactive",
      "channels/threads-and-state",
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
    expect(slack).toContain("signed managed webhook");
    expect(slack).toContain("Interactivity");
    expect(slack).toMatch(/generated manifest[\s\S]{0,160}disabled/i);
    expect(slack).not.toContain("Socket Mode");

    expect(teams).toContain("Adaptive Cards");
    expect(teams).toContain("Action.Submit");
    expect(teams).toMatch(/message\s+activities/);

    for (const filtered of [slack, teams]) {
      expect(filtered).toContain("thread.resume(value)");
      expect(filtered).toContain("](/human-in-the-loop)");
    }
  });

  it("documents the current provider-specific rich UI and event boundaries", () => {
    const rich = bodyFor("channels/rich-messages");
    const commands = bodyFor("channels/commands-and-reactions");
    const slackRich = filterFrontendScopedBlocks(rich, "slack");
    const teamsRich = filterFrontendScopedBlocks(rich, "teams");
    const slackCommands = filterFrontendScopedBlocks(commands, "slack");
    const teamsCommands = filterFrontendScopedBlocks(commands, "teams");

    expect(rich).toMatch(
      /Managed Teams renders Adaptive Card[\s\S]{0,240}other named fields in `ctx\.values`/i,
    );
    expect(slackRich).toMatch(/Slack renderer[\s\S]{0,160}skips chart nodes/i);
    expect(slackRich).toMatch(/post, update, and delete/i);
    expect(teamsRich).toContain("Adaptive Card version 1.5");
    expect(teamsRich).toMatch(/post, update, and delete/i);

    expect(slackCommands).toMatch(
      /generated Slack manifest[\s\S]{0,80}does not register slash commands/i,
    );
    expect(slackCommands).toMatch(
      /user-authored roots and replies[\s\S]{0,180}unrelated workspace messages are ignored/i,
    );
    expect(teamsCommands).toMatch(/does not interpret `\/name` prefixes/i);
    expect(teamsCommands).toContain("`messageReaction`");
    expect(commands).toMatch(/portable set works on managed Slack and Teams/i);
    expect(commands).toMatch(/Output-free handlers are supported/i);
    expect(commands).toMatch(
      /finalizes and acknowledges[\s\S]{0,140}posts\s+no message/i,
    );
    expect(commands).not.toContain("OSS-491");
  });

  it("documents the current Slack and Teams managed file behavior", () => {
    const source = bodyFor("channels/files-and-multimodality");
    const slack = filterFrontendScopedBlocks(source, "slack");
    const teams = filterFrontendScopedBlocks(source, "teams");

    expect(source).toContain("up to 25 MiB");
    expect(source).toContain("`message.contentParts`");
    expect(source).toMatch(/provider-ingest failure[\s\S]{0,100}omit/i);
    expect(source).toMatch(
      /delivers a\s+handle[\s\S]{0,120}short failure note/i,
    );
    expect(slack).toContain("`files:read`");
    expect(slack).toMatch(/external-upload flow/i);
    expect(teams).toContain("`ChannelMessage.Read.Group`");
    expect(teams).toContain("`Files.ReadWrite.All`");
    expect(teams).toMatch(
      /Inline media[\s\S]{0,180}Bot Connector[\s\S]{0,140}does not require Graph consent/i,
    );
    expect(teams).toMatch(
      /Other group-chat file-upload shapes remain unsupported/i,
    );
    expect(teams).toMatch(/Managed Teams supports general outbound files/i);
    expect(teams).toMatch(/channel's SharePoint\s+files area/i);
    expect(teams).toMatch(/native consent-card flow/i);
  });

  it("separates managed history, SDK persistence, and runtime health", () => {
    const persistence = bodyFor("channels/persistence-and-scaling");
    const history = bodyFor("channels/history-and-transcripts");
    const deploy = bodyFor("channels/deploy-and-operate");

    expect(persistence).toContain("the SDK uses `MemoryStore`");
    for (const facet of ["`kv`", "`list`", "`lock`", "`dedup`", "`queue`"]) {
      expect(persistence).toContain(facet);
    }
    expect(persistence).toContain('from "@copilotkit/channels/testing"');
    expect(persistence).toMatch(/Each prepared delivery has one claim winner/i);
    expect(persistence).toMatch(
      /Different replicas can serve different conversations/i,
    );
    expect(persistence).toContain("`maxConcurrentDeliveries`");
    expect(persistence).not.toMatch(/one active owner/i);
    expect(persistence).not.toMatch(/standbys/i);

    expect(history).toMatch(/default history limit[\s\S]{0,80}20 messages/i);
    expect(history).toMatch(/current inbound turn is not part/i);
    expect(history).toMatch(
      /`runAgent\(\)`[\s\S]{0,120}automatically injects/i,
    );
    expect(history).toContain("`thread.getMessages()`");
    expect(history).toContain("`runAgent({ transcript: ... })`");
    expect(history).toMatch(
      /managed entries use the native `"slack"` or `"teams"` provider/i,
    );
    expect(history).not.toContain('platforms: ["slack", "teams"]');

    for (const status of [
      "`connecting`",
      "`online`",
      "`setup_required`",
      "`reconnecting`",
      "`error`",
      "`stopped`",
    ]) {
      expect(deploy).toContain(status);
    }
    expect(deploy).toMatch(
      /Treat only `status\(\)\.overall === "online"` as a\s+healthy connected activation/i,
    );
  });

  it("resumes approvals even when the interaction message cannot be updated", () => {
    for (const slug of ["channels/interactive"] as const) {
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
      referenceBodyFor("callbacks"),
      "teams",
    );

    for (const source of [teamsInteractive, teamsCallbacks]) {
      expect(source).toMatch(
        /Teams[\s\S]{0,240}`Action\.Submit`[\s\S]{0,320}(?:omit|without)[\s\S]{0,120}(?:message ref|`message\.ref\.id`)/i,
      );
    }
  });

  it("limits managed message refs to the delivery that stamped them", () => {
    const source = referenceBodyFor("thread");

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
      expect(filteredTools).toMatch(
        /report the native origin \(`"slack"` or\s+`"teams"`\)/i,
      );
      expect(filteredTools).not.toContain('"intelligence"');
      expect(filteredThreads).toContain("`thread.conversationKey`");
      expect(filteredThreads).toMatch(/conversationKey[\s\S]{0,120}opaque/i);
      expect(filteredThreads).toContain("durable `StateStore`");
      expect(filteredThreads).toMatch(
        /\*\*Online\*\*[\s\S]{0,180}receive delivery\s+invitations/i,
      );
      expect(filteredThreads).not.toMatch(/active or\s+standby/i);
    }
  });

  it("uses the guide labels selected for Slack and Teams navigation", () => {
    expect(navTitleFor("channels/intelligence")).toBe(
      "Configure the Channel in Intelligence",
    );
    expect(navTitleFor("channels/interactive")).toBe(
      "Interactive messages and approvals",
    );
    expect(referenceTitleFor("channel")).toBe("Channel");
    expect(referenceTitleFor("thread")).toBe("Thread");
    expect(referenceTitleFor("callbacks")).toBe("JSX callbacks");
  });

  it("uses the managed createChannel API throughout maintained pages", () => {
    const combinedSource = [
      ...maintainedChannelSlugs.map((slug) => {
        const doc = loadDoc(slug);
        expect(doc, `missing maintained doc: ${slug}`).not.toBeNull();
        return doc!.source;
      }),
      ...Object.keys(channelReferenceFiles).map((key) =>
        referenceBodyFor(key as keyof typeof channelReferenceFiles),
      ),
    ].join("\n");

    expect(combinedSource).toContain("createChannel");
    expect(combinedSource).not.toMatch(
      /\bcreateBot\s*\(|\bdefineBotTool\b|\bCopilotSseRuntime\b|@copilotkit\/channels-ui/i,
    );
    expect(combinedSource).not.toMatch(
      /(?:Slack|Teams)[^\n]{0,60}early access|early access[^\n]{0,60}(?:Slack|Teams)/i,
    );
    const proseWithoutTestedRuntimeVersion = combinedSource.replaceAll(
      "@copilotkit/runtime@1.64.1",
      "",
    );
    expect(proseWithoutTestedRuntimeVersion).not.toMatch(
      /\bcanary\b|\bpinned\b|coordinated launch|launch version|managed launch path/i,
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
