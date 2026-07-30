import { readFileSync } from "node:fs";

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
} from "../channel-guide-routes";

const RAW_DOC_SUFFIXES = ["", ".md", ".mdx"] as const;

interface ResolvedRedirect {
  readonly source: string;
  readonly destination: string;
  readonly permanent: boolean;
}

describe("Next config build boundary", () => {
  it("does not import application runtime modules", () => {
    const source = readFileSync(
      new URL("../../../next.config.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/from\s+["']\.\/src\//);
  });

  it("limits the Turbopack NFT filter to the known config false positive", () => {
    expect(nextConfig.turbopack?.ignoreIssue).toEqual([
      {
        path: /showcase\/shell-docs\/next\.config\.ts$/,
        title: "Encountered unexpected file in NFT list",
      },
    ]);
  });
});

function interpolateDestination(
  destination: string,
  params: Record<string, unknown>,
): string {
  return destination.replace(
    /:([A-Za-z][A-Za-z0-9_]*)([+*]?)/g,
    (_match, name: string) => {
      const value = params[name];
      return Array.isArray(value) ? value.join("/") : String(value ?? "");
    },
  );
}

async function resolveFirstRedirect(
  pathname: string,
): Promise<ResolvedRedirect | null> {
  expect(nextConfig.redirects).toBeTypeOf("function");
  const redirects = await nextConfig.redirects!();

  for (const redirect of redirects) {
    const params = getPathMatch(redirect.source, {
      removeUnnamedParams: true,
      strict: true,
    })(pathname);
    if (params === false) continue;

    return {
      source: redirect.source,
      destination: interpolateDestination(redirect.destination, params),
      permanent: "permanent" in redirect ? Boolean(redirect.permanent) : false,
    };
  }

  return null;
}

async function expectPermanentOneHop(
  source: string,
  destination: string,
): Promise<void> {
  expect(await resolveFirstRedirect(source), source).toEqual(
    expect.objectContaining({
      destination,
      permanent: true,
    }),
  );
  expect(await resolveFirstRedirect(destination), destination).toBeNull();
}

describe("canonical Channels guide redirects", () => {
  it("resolves the complete maintained guide matrix by actual first match", async () => {
    for (const { slug } of CHANNEL_GUIDE_ROUTES) {
      const guideSuffix = slug === "overview" ? "" : `/${slug}`;
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `/channels/${slug}${suffix}`,
          `/slack${guideSuffix}${suffix}`,
        );

        for (const frontend of CHANNEL_FRONTENDS) {
          await expectPermanentOneHop(
            `/${frontend}/mastra/channels/${slug}${suffix}`,
            `/${frontend}/mastra${guideSuffix}${suffix}`,
          );
          await expectPermanentOneHop(
            `/${frontend}/channels/${slug}${suffix}`,
            `/${frontend}${guideSuffix}${suffix}`,
          );
        }

        await expectPermanentOneHop(
          `/mastra/channels/${slug}${suffix}`,
          `/slack/mastra${guideSuffix}${suffix}`,
        );
      }
    }
  });

  it("collapses every explicit Built-in Agent guide shape in one hop", async () => {
    for (const { slug } of CHANNEL_GUIDE_ROUTES) {
      const guideSuffix = slug === "overview" ? "" : `/${slug}`;
      for (const suffix of RAW_DOC_SUFFIXES) {
        for (const frontend of CHANNEL_FRONTENDS) {
          await expectPermanentOneHop(
            `/${frontend}/built-in-agent/${slug}${suffix}`,
            `/${frontend}${guideSuffix}${suffix}`,
          );
          await expectPermanentOneHop(
            `/${frontend}/built-in-agent/channels/${slug}${suffix}`,
            `/${frontend}${guideSuffix}${suffix}`,
          );
        }

        await expectPermanentOneHop(
          `/built-in-agent/channels/${slug}${suffix}`,
          `/slack${guideSuffix}${suffix}`,
        );
      }
    }
  });

  it("redirects the legacy overview and leaves canonical guide URLs alone", async () => {
    for (const suffix of RAW_DOC_SUFFIXES) {
      await expectPermanentOneHop(`/channels${suffix}`, `/slack${suffix}`);
      await expectPermanentOneHop(
        `/slack/overview${suffix}`,
        `/slack${suffix}`,
      );
      await expectPermanentOneHop(
        `/teams/mastra/overview${suffix}`,
        `/teams/mastra${suffix}`,
      );
      await expectPermanentOneHop(
        `/slack/quickstart${suffix}`,
        `/slack/connect${suffix}`,
      );
      await expectPermanentOneHop(
        `/teams/mastra/quickstart${suffix}`,
        `/teams/mastra/connect${suffix}`,
      );
      expect(await resolveFirstRedirect(`/slack/tools${suffix}`)).toBeNull();
      expect(
        await resolveFirstRedirect(`/teams/mastra/threads-and-state${suffix}`),
      ).toBeNull();
    }
  });

  it("does not turn unknown legacy child paths into accidental guide routes", async () => {
    await expect(
      resolveFirstRedirect("/channels/not-a-guide"),
    ).resolves.toBeNull();
    await expect(
      resolveFirstRedirect("/slack/mastra/channels/not-a-guide"),
    ).resolves.toBeNull();
    await expect(
      resolveFirstRedirect("/teams/channels/not-a-guide"),
    ).resolves.toBeNull();
    await expect(
      resolveFirstRedirect("/mastra/channels/not-a-guide"),
    ).resolves.toBeNull();
  });
});

describe("retired Channels guide redirects", () => {
  const retiredGuides = [
    ["quickstart", "connect"],
    ["ui-library", "rich-messages"],
    ["mcp", "tools"],
    ["configuration", "intelligence"],
    ["persistence", "persistence-and-scaling"],
    ["transcripts", "history-and-transcripts"],
  ] as const;

  it("retargets global and scoped aliases directly to final pages", async () => {
    for (const [legacySlug, canonicalSlug] of retiredGuides) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `/channels/${legacySlug}${suffix}`,
          `/slack/${canonicalSlug}${suffix}`,
        );
        await expectPermanentOneHop(
          `/slack/mastra/channels/${legacySlug}${suffix}`,
          `/slack/mastra/${canonicalSlug}${suffix}`,
        );
        await expectPermanentOneHop(
          `/teams/channels/${legacySlug}${suffix}`,
          `/teams/${canonicalSlug}${suffix}`,
        );
        await expectPermanentOneHop(
          `/mastra/channels/${legacySlug}${suffix}`,
          `/slack/mastra/${canonicalSlug}${suffix}`,
        );
        await expectPermanentOneHop(
          `/slack/built-in-agent/channels/${legacySlug}${suffix}`,
          `/slack/${canonicalSlug}${suffix}`,
        );
        await expectPermanentOneHop(
          `/built-in-agent/channels/${legacySlug}${suffix}`,
          `/slack/${canonicalSlug}${suffix}`,
        );
      }
    }
  });

  it("collapses retired interactive subguides without losing raw-doc suffixes", async () => {
    for (const suffix of RAW_DOC_SUFFIXES) {
      await expectPermanentOneHop(
        `/channels/interactive/buttons/approve${suffix}`,
        `/slack/interactive${suffix}`,
      );
      await expectPermanentOneHop(
        `/teams/mastra/channels/interactive/buttons/approve${suffix}`,
        `/teams/mastra/interactive${suffix}`,
      );
    }
  });
});

describe("Channels reference and Bots aliases", () => {
  it("moves provider-scoped API pages back to the global reference", async () => {
    const referenceCases = [
      ["reference/channel", "classes/Channel"],
      ["reference/thread", "classes/Thread"],
      ["reference/callbacks", "types/JSXCallbacks"],
    ] as const;

    for (const [legacyPath, referencePath] of referenceCases) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `/slack/${legacyPath}${suffix}`,
          `/reference/channels/${referencePath}${suffix}`,
        );
        await expectPermanentOneHop(
          `/teams/mastra/${legacyPath}${suffix}`,
          `/reference/channels/${referencePath}${suffix}`,
        );
        await expectPermanentOneHop(
          `/channels/${legacyPath}${suffix}`,
          `/reference/channels/${referencePath}${suffix}`,
        );
      }
    }
  });

  it("leaves the maintained global Channels reference canonical", async () => {
    for (const source of [
      "/reference/channels",
      "/reference/channels/classes/Channel",
      "/reference/channels/classes/Thread",
      "/reference/channels/components/Button",
      "/reference/channels/functions/createChannel",
      "/reference/channels/types/JSXCallbacks",
      "/reference/channels/types/StateStore",
    ]) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        expect(await resolveFirstRedirect(`${source}${suffix}`)).toBeNull();
      }
    }
  });

  it("preserves old reference links across the Channels API rename", async () => {
    const renamedReferences = [
      ["functions/createBot", "functions/createChannel"],
      ["functions/defineBotCommand", "functions/defineChannelCommand"],
      ["functions/defineBotTool", "functions/defineChannelTool"],
      ["types/BotNode", "types/ChannelNode"],
    ] as const;

    for (const [legacyPath, canonicalPath] of renamedReferences) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `/reference/channels/${legacyPath}${suffix}`,
          `/reference/channels/${canonicalPath}${suffix}`,
        );
      }
    }
  });

  it("retargets stale provider internals to the maintained direct-adapter inventory", async () => {
    for (const source of [
      "/reference/channels/slack",
      "/reference/channels/slack/renderBlockKit",
      "/reference/channels/discord",
      "/reference/channels/discord/DISCORD_LIMITS",
    ]) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `${source}${suffix}`,
          `/reference/channels/sdk/direct-adapters${suffix}`,
        );
      }
    }
  });

  it("sends known Bots pages straight to their final canonical destinations", async () => {
    for (const suffix of RAW_DOC_SUFFIXES) {
      await expectPermanentOneHop(`/bots${suffix}`, `/slack${suffix}`);
      await expectPermanentOneHop(
        `/bots/tools${suffix}`,
        `/slack/tools${suffix}`,
      );
      await expectPermanentOneHop(
        `/bots/quickstart${suffix}`,
        `/slack/connect${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot${suffix}`,
        `/reference/channels${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/classes/Thread${suffix}`,
        `/reference/channels${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/types/InteractionContext${suffix}`,
        `/reference/channels${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/components/ApproveButton${suffix}`,
        `/reference/channels${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/classes/Bot${suffix}`,
        `/reference/channels${suffix}`,
      );
    }
  });
});

describe("Channels roots and coming-soon platforms", () => {
  it("preserves platform roots and coming-soon fallbacks", async () => {
    await expectPermanentOneHop("/channels/platforms/slack", "/slack");
    await expectPermanentOneHop("/channels/platforms/teams", "/teams");
    await expectPermanentOneHop("/channels/platforms/discord", "/slack");
    await expectPermanentOneHop("/whatsapp", "/slack");
    await expectPermanentOneHop("/whatsapp/quickstart", "/slack");
  });

  it("keeps specific roots ahead of broad legacy framework roots", async () => {
    await expectPermanentOneHop("/slack/mastra/channels", "/slack/mastra");
    await expectPermanentOneHop("/teams/channels", "/teams");
    await expectPermanentOneHop("/slack/built-in-agent/channels", "/slack");
    await expectPermanentOneHop("/built-in-agent/channels", "/slack");
  });
});
