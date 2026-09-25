/**
 * Guarantees lifted from the Angular host into the shared core, so every
 * frontend gets them instead of re-implementing (or silently losing) them:
 *
 * - the requested resource is selected by URI, not by position;
 * - base64 bodies decode as UTF-8, not latin1;
 * - a tool result keeps the keys the server sent (notably `_meta`).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { bindMcpApp, ɵdecodeBase64 } from "../session";
import type { McpAppSession, FetchedResource } from "../session";
import { MCPAppsActivityContentSchema } from "../content-schema";

let sessions: McpAppSession[] = [];
let iframes: HTMLIFrameElement[] = [];

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

/** Agent whose `resources/read` returns the supplied contents verbatim. */
function makeAgent(contents: unknown[]) {
  return {
    threadId: "thread-1",
    isRunning: false,
    subscribe: () => ({ unsubscribe() {} }),
    addMessage() {},
    async runAgent() {
      return { result: { contents }, newMessages: [] };
    },
  } as unknown as AbstractAgent;
}

/** Bind a session and resolve the resource the session actually selected. */
async function resolveResource(contents: unknown[], resourceUri: string) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframes.push(iframe);

  let resource: FetchedResource | undefined;
  const onError = vi.fn();
  sessions.push(
    bindMcpApp({
      iframe,
      getContent: () =>
        ({ resourceUri, serverHash: "hash", result: { content: [] } }) as never,
      getAgent: () => makeAgent(contents),
      host: { runAgent: async () => ({ result: undefined, newMessages: [] }) },
      hooks: {
        onResource: (r) => {
          resource = r;
        },
        onError,
      },
    }),
  );
  await tick();
  return { resource, onError };
}

afterEach(() => {
  sessions.forEach((s) => s.teardown());
  sessions = [];
  iframes.forEach((f) => f.remove());
  iframes = [];
  vi.restoreAllMocks();
});

describe("resource selection", () => {
  it("loads the resource matching the requested uri, not the first one", async () => {
    const { resource, onError } = await resolveResource(
      [
        {
          uri: "ui://server/other",
          mimeType: "text/html",
          text: "<p>WRONG</p>",
        },
        {
          uri: "ui://server/wanted",
          mimeType: "text/html",
          text: "<p>RIGHT</p>",
        },
      ],
      "ui://server/wanted",
    );

    expect(onError).not.toHaveBeenCalled();
    expect(resource?.uri).toBe("ui://server/wanted");
    expect(resource?.text).toContain("RIGHT");
  });

  it("still accepts a single content whose uri the server rewrote", async () => {
    const { resource, onError } = await resolveResource(
      [
        {
          uri: "ui://server/normalized",
          mimeType: "text/html",
          text: "<p>ok</p>",
        },
      ],
      "ui://server/requested",
    );

    expect(onError).not.toHaveBeenCalled();
    expect(resource?.uri).toBe("ui://server/normalized");
  });

  it("errors rather than guessing when several contents all mismatch", async () => {
    const { resource, onError } = await resolveResource(
      [
        { uri: "ui://server/a", text: "<p>a</p>" },
        { uri: "ui://server/b", text: "<p>b</p>" },
      ],
      "ui://server/requested",
    );

    expect(resource).toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});

describe("base64 resource decoding", () => {
  it("decodes a non-ASCII blob as UTF-8", () => {
    const html = "<p>Été ☀️</p>";
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(html)));

    // The pre-fix implementation was a bare `atob`, which yields latin1.
    expect(atob(base64)).not.toBe(html);
    expect(ɵdecodeBase64(base64)).toBe(html);
  });

  it("reports invalid base64 instead of throwing a raw DOM error", () => {
    expect(() => ɵdecodeBase64("not-base64!!")).toThrow(/invalid base64/i);
  });
});

describe("tool result envelope", () => {
  it("keeps result._meta and server-specific keys through validation", () => {
    const parsed = MCPAppsActivityContentSchema.parse({
      resourceUri: "ui://server/app",
      serverHash: "hash",
      result: {
        content: [{ type: "text", text: "ok" }],
        _meta: { traceId: "abc-123" },
        serverSpecific: { page: 2 },
      },
    });

    const result = parsed.result as Record<string, unknown>;
    expect(result._meta).toEqual({ traceId: "abc-123" });
    expect(result.serverSpecific).toEqual({ page: 2 });
  });
});
