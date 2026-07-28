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
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `/channels/${slug}${suffix}`,
          `/slack/${slug}${suffix}`,
        );

        for (const frontend of CHANNEL_FRONTENDS) {
          await expectPermanentOneHop(
            `/${frontend}/mastra/channels/${slug}${suffix}`,
            `/${frontend}/mastra/${slug}${suffix}`,
          );
          await expectPermanentOneHop(
            `/${frontend}/channels/${slug}${suffix}`,
            `/${frontend}/${slug}${suffix}`,
          );
        }

        await expectPermanentOneHop(
          `/mastra/channels/${slug}${suffix}`,
          `/slack/mastra/${slug}${suffix}`,
        );
      }
    }
  });

  it("collapses every explicit Built-in Agent guide shape in one hop", async () => {
    for (const { slug } of CHANNEL_GUIDE_ROUTES) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        for (const frontend of CHANNEL_FRONTENDS) {
          await expectPermanentOneHop(
            `/${frontend}/built-in-agent/${slug}${suffix}`,
            `/${frontend}/${slug}${suffix}`,
          );
          await expectPermanentOneHop(
            `/${frontend}/built-in-agent/channels/${slug}${suffix}`,
            `/${frontend}/${slug}${suffix}`,
          );
        }

        await expectPermanentOneHop(
          `/built-in-agent/channels/${slug}${suffix}`,
          `/slack/${slug}${suffix}`,
        );
      }
    }
  });

  it("leaves the overview and canonical guide URLs alone", async () => {
    for (const suffix of RAW_DOC_SUFFIXES) {
      expect(await resolveFirstRedirect(`/channels${suffix}`)).toBeNull();
      expect(await resolveFirstRedirect(`/slack/tools${suffix}`)).toBeNull();
      expect(
        await resolveFirstRedirect(`/teams/mastra/reference/thread${suffix}`),
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
    ["quickstart", "intelligence"],
    ["ui-library", "interactive"],
    ["commands-and-reactions", "interactive"],
    ["files-and-multimodality", "tools"],
    ["mcp", "tools"],
    ["configuration", "intelligence"],
    ["persistence", "threads-and-state"],
    ["transcripts", "threads-and-state"],
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

describe("generated reference and Bots aliases", () => {
  it("resolves generated Channels references before framework catch-alls", async () => {
    const generatedReferenceCases = [
      ["/reference/channels/classes/Thread", "/slack/reference/thread"],
      [
        "/reference/channels/types/InteractionContext",
        "/slack/reference/callbacks",
      ],
      [
        "/reference/channels/components/ApproveButton",
        "/slack/reference/callbacks",
      ],
      ["/reference/channels/classes/Channel", "/slack/reference/channel"],
      ["/reference/channels", "/slack/reference/channel"],
    ] as const;

    for (const [source, destination] of generatedReferenceCases) {
      for (const suffix of RAW_DOC_SUFFIXES) {
        await expectPermanentOneHop(
          `${source}${suffix}`,
          `${destination}${suffix}`,
        );
      }
    }
  });

  it("sends known Bots pages straight to their final canonical destinations", async () => {
    for (const suffix of RAW_DOC_SUFFIXES) {
      await expectPermanentOneHop(`/bots${suffix}`, `/channels${suffix}`);
      await expectPermanentOneHop(
        `/bots/tools${suffix}`,
        `/slack/tools${suffix}`,
      );
      await expectPermanentOneHop(
        `/bots/quickstart${suffix}`,
        `/slack/intelligence${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot${suffix}`,
        `/slack/reference/channel${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/classes/Thread${suffix}`,
        `/slack/reference/thread${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/types/InteractionContext${suffix}`,
        `/slack/reference/callbacks${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/components/ApproveButton${suffix}`,
        `/slack/reference/callbacks${suffix}`,
      );
      await expectPermanentOneHop(
        `/reference/bot/classes/Bot${suffix}`,
        `/slack/reference/channel${suffix}`,
      );
    }
  });
});

describe("Channels roots and coming-soon platforms", () => {
  it("preserves platform roots and coming-soon fallbacks", async () => {
    await expectPermanentOneHop("/channels/platforms/slack", "/slack");
    await expectPermanentOneHop("/channels/platforms/teams", "/teams");
    await expectPermanentOneHop("/channels/platforms/discord", "/channels");
    await expectPermanentOneHop("/whatsapp", "/channels");
    await expectPermanentOneHop("/whatsapp/quickstart", "/channels");
  });

  it("keeps specific roots ahead of broad legacy framework roots", async () => {
    await expectPermanentOneHop("/slack/mastra/channels", "/slack/mastra");
    await expectPermanentOneHop("/teams/channels", "/teams");
    await expectPermanentOneHop("/slack/built-in-agent/channels", "/slack");
    await expectPermanentOneHop("/built-in-agent/channels", "/slack");
  });
});
