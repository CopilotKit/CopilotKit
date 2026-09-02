import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  announcementPreview,
  clearLegacyAnnouncementReadState,
  loadAnnouncementFeed,
  loadAnnouncementPulsedTimestamp,
  loadAnnouncementReadTimestamp,
  projectAnnouncementFeed,
  saveAnnouncementPulsedTimestamp,
  saveAnnouncementReadTimestamp,
} from "./feed.js";

const originalCookieDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "cookie",
);
const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "sessionStorage",
);

function restoreDocumentCookie(): void {
  if (originalCookieDescriptor) {
    Object.defineProperty(document, "cookie", originalCookieDescriptor);
  } else {
    Reflect.deleteProperty(document, "cookie");
  }
}

function restoreSessionStorage(): void {
  if (originalSessionStorageDescriptor) {
    Object.defineProperty(
      window,
      "sessionStorage",
      originalSessionStorageDescriptor,
    );
  } else {
    Reflect.deleteProperty(window, "sessionStorage");
  }
}

function resetBrowserState(): void {
  restoreDocumentCookie();
  restoreSessionStorage();
  document.cookie =
    "cpk_inspector_announcements=; Path=/; Max-Age=0; SameSite=Lax";
  window.localStorage.clear();
  window.sessionStorage.clear();
}

function moveToAnotherLocalhostPort(): void {
  window.localStorage.clear();
}

function blockCookies(): void {
  Object.defineProperty(document, "cookie", {
    get: () => "",
    set: () => {},
    configurable: true,
  });
}

beforeEach(resetBrowserState);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetBrowserState();
});

describe("projectAnnouncementFeed", () => {
  it.each([
    null,
    { timestamp: 42, announcement: "content" },
    { timestamp: "", announcement: "content" },
    { timestamp: "release-27", announcement: "" },
  ])("rejects malformed feed %j without exposing partial content", (value) => {
    expect(projectAnnouncementFeed(value)).toEqual({ status: "invalid" });
  });

  it("keeps code content escaped in the rendered announcement", () => {
    const scriptTag = ["<", "script", ">"].join("");
    const closingTag = ["</", "script", ">"].join("");
    const projection = projectAnnouncementFeed({
      timestamp: "2026-08-01T00:00:00.000Z",
      previewText: "Update",
      announcement: `\`\`\`html\n${scriptTag}alert(1)${closingTag}\n\`\`\``,
    });

    expect(projection.status).toBe("ready");
    if (projection.status === "ready") {
      expect(projection.documentHtml).not.toContain(scriptTag);
      expect(projection.documentHtml).toContain("&lt;script&gt;");
    }
  });

  it("preserves compatible fields and ignores unknown fields", () => {
    const projection = projectAnnouncementFeed({
      timestamp: "release-27",
      previewText: " Release notes ",
      announcement: "Update",
      cta_label: "Read more",
      extra: { private: "ignored" },
    });
    expect(projection).toMatchObject({
      status: "ready",
      timestamp: "release-27",
      preview: { text: "Release notes" },
      ctaLabel: "Read more",
    });
    expect(projection).not.toHaveProperty("extra");
  });

  it("accepts whitespace-only markdown without rendering or arming", () => {
    expect(
      projectAnnouncementFeed({ timestamp: "release-27", announcement: "   " }),
    ).toMatchObject({ status: "ready", documentHtml: "", shouldArm: false });
  });

  it("projects a markdown-free preview", () => {
    expect(announcementPreview("## Hello\nRead [docs](https://x.test).")).toBe(
      "Hello Read docs.",
    );
  });
});

describe("loadAnnouncementFeed", () => {
  it.each([
    [new Response(null, { status: 503 }), "Failed to load announcement (503)"],
    [
      new Response(JSON.stringify({ timestamp: 42, announcement: "Update" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      "Malformed announcement payload",
    ],
  ])("surfaces a failed feed load", async (response, message) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(loadAnnouncementFeed(fetcher)).resolves.toEqual({
      status: "failed",
    });
    expect(warning).toHaveBeenCalledWith(
      "[CopilotKit Inspector] Failed to load announcement",
      expect.objectContaining({ message }),
    );
  });
});

describe("announcement persistence", () => {
  it("reports nothing before an announcement is read or pulsed", () => {
    expect(loadAnnouncementReadTimestamp()).toBeNull();
    expect(loadAnnouncementPulsedTimestamp()).toBeNull();
  });

  it("keeps read state after moving to another localhost port", () => {
    saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z");

    moveToAnotherLocalhostPort();

    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-19T10:00:00.000Z");
  });

  it("reports the most recently read announcement", () => {
    saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z");
    saveAnnouncementReadTimestamp("2026-08-20T10:00:00.000Z");

    moveToAnotherLocalhostPort();

    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-20T10:00:00.000Z");
  });

  it("degrades to per-port read state when cookies are blocked", () => {
    blockCookies();

    expect(() =>
      saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z"),
    ).not.toThrow();
    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-19T10:00:00.000Z");

    moveToAnotherLocalhostPort();
    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("ignores malformed read state", () => {
    document.cookie = "cpk_inspector_announcements=%7Bnot-json";

    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("falls back to localStorage when cookie access throws", () => {
    Object.defineProperty(document, "cookie", {
      get: () => {
        throw new DOMException("SecurityError");
      },
      set: () => {
        throw new DOMException("SecurityError");
      },
      configurable: true,
    });

    expect(() =>
      saveAnnouncementReadTimestamp("2026-08-19T10:00:00.000Z"),
    ).not.toThrow();
    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-19T10:00:00.000Z");
  });

  it("does not throw without a browser window", () => {
    vi.stubGlobal("window", undefined);

    expect(() => saveAnnouncementReadTimestamp("ts")).not.toThrow();
    expect(() => loadAnnouncementReadTimestamp()).not.toThrow();
  });

  it("records which announcement the tab pulsed for", () => {
    saveAnnouncementPulsedTimestamp("2026-08-19T10:00:00.000Z");
    expect(loadAnnouncementPulsedTimestamp()).toBe("2026-08-19T10:00:00.000Z");

    saveAnnouncementPulsedTimestamp("2026-08-20T10:00:00.000Z");
    expect(loadAnnouncementPulsedTimestamp()).toBe("2026-08-20T10:00:00.000Z");
  });

  it("keeps pulse suppression separate from read state", () => {
    saveAnnouncementPulsedTimestamp("2026-08-19T10:00:00.000Z");

    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("does not throw when sessionStorage is unavailable", () => {
    Object.defineProperty(window, "sessionStorage", {
      get: () => {
        throw new DOMException("SecurityError");
      },
      configurable: true,
    });

    expect(() => saveAnnouncementPulsedTimestamp("ts")).not.toThrow();
    expect(loadAnnouncementPulsedTimestamp()).toBeNull();
  });

  it("deletes the legacy read key instead of migrating it", () => {
    window.localStorage.setItem(
      "cpk:inspector:announcements",
      JSON.stringify({ timestamp: "old" }),
    );
    clearLegacyAnnouncementReadState();
    expect(
      window.localStorage.getItem("cpk:inspector:announcements"),
    ).toBeNull();
    expect(loadAnnouncementReadTimestamp()).toBeNull();
  });

  it("cannot resurrect legacy state after a new announcement is read", () => {
    window.localStorage.setItem(
      "cpk:inspector:announcements",
      JSON.stringify({ timestamp: "2026-08-01T10:00:00.000Z" }),
    );

    clearLegacyAnnouncementReadState();
    saveAnnouncementReadTimestamp("2026-08-20T10:00:00.000Z");
    clearLegacyAnnouncementReadState();

    expect(
      window.localStorage.getItem("cpk:inspector:announcements"),
    ).toBeNull();
    expect(loadAnnouncementReadTimestamp()).toBe("2026-08-20T10:00:00.000Z");
  });

  it("clears legacy state safely on every startup", () => {
    expect(() => {
      clearLegacyAnnouncementReadState();
      clearLegacyAnnouncementReadState();
    }).not.toThrow();

    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => clearLegacyAnnouncementReadState()).not.toThrow();
  });
});
