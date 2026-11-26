// The four messaging channels in early access (iMessage, WhatsApp, SMS, RCS)
// are ordinary frontends with one flag. The flag draws the "Early access"
// badge and makes the frontend's landing page (`/whatsapp`) its only page:
// "does this stack have this page" says no for every docs page, so every
// link builder falls back to that landing page.
import { describe, expect, test, vi } from "vitest";

// live-scope.ts and stack-href.ts import through shell-docs' `@/` alias,
// which this package doesn't resolve: point those specifiers at the files,
// and stand in for the generated registry (shell-docs' src/data is
// gitignored) and the browser-only hooks stack-href.ts imports.
vi.mock("@/data/docs-modes.json", () => ({
  default: { mastra: "generated", "langgraph-python": "generated" },
}));
vi.mock(
  "@/lib/frontends",
  () => import("../../../shell-docs/src/lib/frontends"),
);
vi.mock(
  "@/lib/live-scope",
  () => import("../../../shell-docs/src/lib/live-scope"),
);
vi.mock(
  "@/lib/live-pages",
  () => import("../../../shell-docs/src/lib/live-pages"),
);
vi.mock("react", () => ({ useCallback: <T>(fn: T) => fn }));
vi.mock("../../../shell-docs/src/proto/frontend", () => ({}));
vi.mock("../../../shell-docs/src/proto/last-framework", () => ({}));
vi.mock("../../../shell-docs/src/proto/live-pages-context", () => ({}));

import {
  FRONTENDS,
  frontendEventProperties,
  hasDocs,
  landingPage,
} from "../../../shell-docs/src/lib/frontends";
import type { FrontendId } from "../../../shell-docs/src/lib/frontends";
import { EARLY_ACCESS_CHANNEL_IDS } from "../../../shell-docs/src/lib/early-access/channels";
import { whereIs } from "../../../shell-docs/src/lib/live-pages";
import type { PageIndex } from "../../../shell-docs/src/lib/live-pages";
import {
  UNSCOPED_SEGMENTS,
  frontendHref,
  isChannel,
} from "../../../shell-docs/src/lib/live-scope";
import {
  stackHref,
  stackPage,
  stackPrefix,
} from "../../../shell-docs/src/proto/stack-href";

const EARLY_ACCESS = ["imessage", "whatsapp", "sms", "rcs"] as const;

/** A small page index: one page of each kind a reader can be sent to. */
const INDEX: PageIndex = {
  folders: {
    "frontends/vue": ["", "frontend-tools"],
    "frontends/slack": ["", "connect"],
    channels: ["tools"],
    "integrations/mastra": ["", "mastra-only"],
  },
  react: ["quickstart", "frontend-tools"],
  shared: ["generative-ui"],
  unsupported: {},
};

describe("the frontend list", () => {
  test("holds the early-access channels after Slack and Teams, flagged, as channels", () => {
    expect(FRONTENDS.map((f) => f.id)).toEqual([
      "react",
      "vue",
      "angular",
      "react-native",
      "slack",
      "teams",
      ...EARLY_ACCESS,
    ]);
    for (const f of FRONTENDS) {
      const early = (EARLY_ACCESS as readonly string[]).includes(f.id);
      expect(!!f.earlyAccess, f.id).toBe(early);
      if (early) {
        expect(f.kind).toBe("channel");
        expect(f.group).toBe("Channels");
      }
    }
  });

  test("is where the booker's channel list comes from", () => {
    expect([...EARLY_ACCESS_CHANNEL_IDS]).toEqual([...EARLY_ACCESS]);
  });
});

describe("an early-access frontend's only page", () => {
  test("is its landing page", () => {
    for (const id of EARLY_ACCESS) expect(landingPage(id)).toBe(`/${id}`);
    for (const id of ["react", "vue", "slack", "teams"]) {
      expect(landingPage(id)).toBeNull();
    }
  });

  test("so it has no docs page, on any framework", () => {
    for (const id of EARLY_ACCESS) {
      for (const framework of [null, "mastra"]) {
        for (const slug of [
          "",
          "quickstart",
          "connect",
          "tools",
          "frontend-tools",
          "generative-ui",
          "mastra-only",
        ]) {
          expect(whereIs(INDEX, id, framework, slug), `${id} ${slug}`).toBe(
            null,
          );
        }
      }
    }
  });

  test("while the other frontends keep theirs", () => {
    expect(whereIs(INDEX, "react", null, "generative-ui")).toEqual({
      kind: "shared",
      slug: "generative-ui",
    });
    expect(whereIs(INDEX, "slack", "mastra", "connect")).toEqual({
      kind: "frontend",
      folder: "frontends/slack",
      slug: "connect",
    });
    expect(whereIs(INDEX, "slack", null, "quickstart")).toEqual({
      kind: "frontend",
      folder: "frontends/slack",
      slug: "",
    });
    expect(whereIs(INDEX, "vue", "mastra", "mastra-only")).toEqual({
      kind: "framework",
      folder: "integrations/mastra",
      slug: "mastra-only",
    });
  });

  test("is where every per-stack link falls back to", () => {
    for (const id of EARLY_ACCESS) {
      for (const framework of [null, "built-in-agent", "mastra"]) {
        for (const slug of ["", "quickstart", "connect", "generative-ui"]) {
          expect(stackHref(id, framework, slug, INDEX)).toBe(`/${id}`);
          expect(stackPage(id, framework, slug, INDEX)).toBe(`/${id}`);
          // Without the page index too.
          expect(stackPage(id, framework, slug, null)).toBe(`/${id}`);
          expect(stackHref(id, framework, slug, null)).toBe(`/${id}`);
        }
      }
    }
  });

  test("while a stack's prefix stays a prefix", () => {
    expect(stackPrefix("vue", "mastra")).toBe("/vue/mastra");
    expect(stackPrefix("react", "built-in-agent")).toBe("");
    expect(stackPage("vue", "mastra", "frontend-tools", null)).toBe(
      "/vue/mastra/frontend-tools",
    );
    expect(stackPage("vue", "mastra", "nope", INDEX)).toBeNull();
  });

  test("is what the frontend pickers open, from any page", () => {
    for (const id of EARLY_ACCESS) {
      expect(frontendHref([], id, "")).toBe(`/${id}`);
      expect(frontendHref(["mastra", "quickstart"], id, "")).toBe(`/${id}`);
      expect(frontendHref(["vue", "mastra", "frontend-tools"], id)).toBe(
        `/${id}`,
      );
    }
  });

  test("leaves the other frontends' links as they were", () => {
    expect(stackHref("react", "mastra", "generative-ui", INDEX)).toBe(
      "/mastra/generative-ui",
    );
    expect(stackHref("react", "mastra", "nope", INDEX)).toBe(
      "/mastra/quickstart",
    );
    expect(stackHref("slack", "mastra", "connect", INDEX)).toBe(
      "/slack/mastra/connect",
    );
    expect(stackHref("vue", null, "nope", INDEX)).toBe("/vue");
    expect(frontendHref(["mastra", "quickstart"], "vue", "")).toBe(
      "/vue/mastra",
    );
    expect(frontendHref(["vue", "mastra"], "react", "")).toBe(
      "/mastra/quickstart",
    );
  });

  test("means the frontend has no docs", () => {
    for (const id of EARLY_ACCESS) expect(hasDocs(id)).toBe(false);
    for (const f of FRONTENDS.filter((f) => !f.earlyAccess)) {
      expect(hasDocs(f.id)).toBe(true);
    }
    expect(hasDocs("nope")).toBe(false);
  });

  test("is never scoped under a reader's stack", () => {
    for (const id of EARLY_ACCESS) expect(UNSCOPED_SEGMENTS.has(id)).toBe(true);
  });

  test("doesn't share the Slack and Teams channel guide", () => {
    expect(isChannel("slack")).toBe(true);
    expect(isChannel("teams")).toBe(true);
    for (const id of EARLY_ACCESS) expect(isChannel(id)).toBe(false);
  });
});

describe("a frontend pick's analytics", () => {
  test("marks an early-access frontend, and only one, with early_access", () => {
    for (const id of EARLY_ACCESS) {
      expect(frontendEventProperties(id)).toEqual({
        frontend: id,
        early_access: true,
      });
    }
    for (const id of ["react", "vue", "slack", "teams"] as FrontendId[]) {
      expect(frontendEventProperties(id)).toEqual({ frontend: id });
    }
  });
});
