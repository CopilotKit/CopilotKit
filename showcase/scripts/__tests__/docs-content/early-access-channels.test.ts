// The docs' early-access channel pages (/imessage, /whatsapp, /sms, /rcs),
// one page each, at one URL. next.config's redirects list the channels by
// hand (they can't import app code), so the two lists must match and the
// channels' rules must run before any legacy `:framework` rule.
// `scripts/check-redirects.mjs` checks the same redirects on a running server.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

// markdown.ts and live-scope.ts import through shell-docs' `@/` alias, which
// this package doesn't resolve: point those specifiers at the files, and
// stand in for the generated registry (shell-docs' src/data is gitignored).
vi.mock("@/data/docs-modes.json", () => ({
  default: { mastra: "generated", "langgraph-python": "generated" },
}));
vi.mock(
  "@/lib/early-access/channels",
  () => import("../../../shell-docs/src/lib/early-access/channels"),
);
vi.mock(
  "@/lib/base-path",
  () => import("../../../shell-docs/src/lib/base-path"),
);

import {
  EARLY_ACCESS_CHANNEL_IDS as REDIRECTED_CHANNEL_IDS,
  nextConfigRedirects,
} from "../../../shell-docs/src/lib/redirects/next-config-redirects.mjs";
import { EARLY_ACCESS_CHANNEL_IDS } from "../../../shell-docs/src/lib/early-access/channels";
import {
  channelMarkdownResponse,
  channelPageMarkdown,
} from "../../../shell-docs/src/lib/early-access/markdown";
import {
  UNSCOPED_SEGMENTS,
  scopedHref,
} from "../../../shell-docs/src/lib/live-scope";

const SHELL_DOCS = path.resolve(import.meta.dirname, "../../../shell-docs");
const CHANNEL = `:channel(${EARLY_ACCESS_CHANNEL_IDS.join("|")})`;

describe("next.config redirects under the early-access channels", () => {
  test("list the same channels as the app", () => {
    expect([...REDIRECTED_CHANNEL_IDS]).toEqual([...EARLY_ACCESS_CHANNEL_IDS]);
  });

  test("send a path under a channel to its page, temporarily, before any other rule", () => {
    expect(nextConfigRedirects.slice(0, 3)).toEqual([
      {
        source: `/${CHANNEL}/:path+.md`,
        destination: "/:channel.md",
        permanent: false,
      },
      {
        source: `/${CHANNEL}/:path+.mdx`,
        destination: "/:channel.md",
        permanent: false,
      },
      {
        source: `/${CHANNEL}/:path+`,
        destination: "/:channel",
        permanent: false,
      },
    ]);
  });

  test("leave no leading-param rule ahead of them", () => {
    // `/:framework(...)/channels` caught `/whatsapp/channels` and sent it,
    // permanently, to `/slack/whatsapp`, a 404.
    const first = nextConfigRedirects.find((rule) =>
      rule.source.startsWith("/:"),
    );
    expect(first?.source.startsWith(`/${CHANNEL}/`)).toBe(true);
  });

  test("send WhatsApp's old platform page to its page, before the Slack catch-all", () => {
    const sources = nextConfigRedirects.map((rule) => rule.source);
    for (const suffix of [".md", ".mdx", ""]) {
      const own = sources.indexOf(`/channels/platforms/whatsapp${suffix}`);
      expect(own).toBeGreaterThan(-1);
      expect(nextConfigRedirects[own]).toMatchObject({
        destination: `/whatsapp${suffix}`,
        permanent: true,
      });
      expect(own).toBeLessThan(
        sources.indexOf(`/channels/platforms/:path*${suffix}`),
      );
    }
  });
});

describe("Markdown under an early-access channel", () => {
  test("a path under a channel redirects to the channel's Markdown", () => {
    for (const id of EARLY_ACCESS_CHANNEL_IDS) {
      for (const rest of [["quickstart"], ["channels"], ["a", "b"]]) {
        const response = channelMarkdownResponse([id, ...rest]);
        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe(`/${id}.md`);
      }
    }
  });

  test("the channel's own path is its Markdown", async () => {
    const response = channelMarkdownResponse(["whatsapp"]);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(await response?.text()).toBe(channelPageMarkdown("whatsapp"));
  });

  test("other paths are not a channel's", () => {
    expect(channelMarkdownResponse([])).toBeNull();
    expect(channelMarkdownResponse(["quickstart"])).toBeNull();
    expect(channelMarkdownResponse(["mastra", "whatsapp"])).toBeNull();
  });
});

describe("links to an early-access channel", () => {
  test("are never scoped under the reader's framework or frontend", () => {
    for (const id of EARLY_ACCESS_CHANNEL_IDS) {
      expect(UNSCOPED_SEGMENTS.has(id)).toBe(true);
      expect(
        scopedHref(`/${id}`, { frontend: "react", framework: "mastra" }),
      ).toBe(`/${id}`);
      expect(
        scopedHref(`/${id}`, { frontend: "vue", framework: "mastra" }),
      ).toBe(`/${id}`);
      expect(
        scopedHref(`/${id}#book`, { frontend: "slack", framework: null }),
      ).toBe(`/${id}#book`);
    }
  });

  test("leave docs links scoped as before", () => {
    expect(
      scopedHref("/quickstart", { frontend: "vue", framework: "mastra" }),
    ).toBe("/vue/mastra/quickstart");
    expect(
      scopedHref("/whatsapp-guide", { frontend: "react", framework: "mastra" }),
    ).toBe("/mastra/whatsapp-guide");
  });
});

describe("the channel list every docs page loads", () => {
  test("imports nothing, so the landing pages' copy stays out of the docs' bundle", () => {
    const source = fs.readFileSync(
      path.join(SHELL_DOCS, "src/lib/early-access/channels.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
