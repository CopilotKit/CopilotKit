/**
 * Thread events and state on an Intelligence runtime are served only to the
 * thread's owner.
 *
 * Requests go through the real fetch handler, thread handlers and
 * `CopilotKitIntelligence` client. Only the platform is faked, at the HTTP
 * level: like the real `_inspect` endpoints, the fake serves events and state
 * for any thread id under the project key, while the user-scoped thread
 * lookup answers 404 for a thread the user does not own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotKitIntelligence } from "../intelligence-platform";

const PLATFORM = "https://platform.test";
const ALICE_THREAD = "thread-alice";

const OWNERS: Record<string, string> = { [ALICE_THREAD]: "alice" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakePlatform(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const inspect = url.pathname.match(
    /^\/api\/_inspect\/threads\/([^/]+)\/(events|state)$/,
  );
  if (inspect) {
    const [, threadId, kind] = inspect;
    // The platform scopes `_inspect` reads to the bare end-user id too.
    if (
      !OWNERS[threadId!] ||
      OWNERS[threadId!] !== url.searchParams.get("userId")
    ) {
      return Promise.resolve(json({}, 404));
    }
    return Promise.resolve(
      kind === "events"
        ? json({
            events: [
              { type: "STATE_SNAPSHOT", snapshot: { secret: "ALICE_SECRET" } },
            ],
          })
        : json({ kind: "snapshot", state: { secret: "ALICE_SECRET" } }),
    );
  }
  const thread = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (thread) {
    const threadId = thread[1]!;
    const owner = OWNERS[threadId];
    if (!owner || owner !== url.searchParams.get("userId")) {
      return Promise.resolve(json({ error: "Thread not found" }, 404));
    }
    return Promise.resolve(
      json({
        thread: {
          id: threadId,
          name: null,
          agentId: "assistant",
          organizationId: "org-1",
          createdById: owner,
          archived: false,
          createdAt: "2026-10-26T00:00:00.000Z",
          updatedAt: "2026-10-26T00:00:00.000Z",
        },
      }),
    );
  }
  return Promise.resolve(json({ error: "unexpected" }, 500));
}

function makeHandler() {
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence: new CopilotKitIntelligence({
      apiUrl: PLATFORM,
      wsUrl: "wss://platform.test",
      apiKey: "project-key",
    }),
    identifyUser: (request: Request) => {
      const id = request.headers.get("x-test-user") ?? "";
      return { id, name: id };
    },
  });
  return createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });
}

function get(
  handler: (r: Request) => Promise<Response>,
  path: string,
  user: string,
) {
  return handler(
    new Request(`http://localhost/api/copilotkit${path}`, {
      headers: { "x-test-user": user },
    }),
  );
}

describe("Intelligence thread events and state ownership", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(fakePlatform));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses another user's thread events and state", async () => {
    const handler = makeHandler();
    for (const suffix of ["events", "state"]) {
      const response = await get(
        handler,
        `/threads/${ALICE_THREAD}/${suffix}`,
        "bob",
      );
      const text = await response.text();
      expect(text).not.toContain("ALICE_SECRET");
      expect(response.status).toBe(404);
    }
    // The project-key `_inspect` endpoints are never called for Bob.
    const urls = vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        String(input instanceof Request ? input.url : input),
      );
    expect(urls.some((url) => url.includes("/_inspect/"))).toBe(false);
  });

  it("still serves the owner's thread events and state", async () => {
    const handler = makeHandler();
    const events = await get(
      handler,
      `/threads/${ALICE_THREAD}/events`,
      "alice",
    );
    expect(events.status).toBe(200);
    expect(await events.text()).toContain("ALICE_SECRET");
    const state = await get(handler, `/threads/${ALICE_THREAD}/state`, "alice");
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({ state: { secret: "ALICE_SECRET" } });
  });

  it("sends the bare end-user id on every _inspect read", async () => {
    const handler = makeHandler();
    await get(handler, `/threads/${ALICE_THREAD}/events`, "alice");
    await get(handler, `/threads/${ALICE_THREAD}/state`, "alice");
    const inspected = vi
      .mocked(fetch)
      .mock.calls.map(
        ([input]) =>
          new URL(String(input instanceof Request ? input.url : input)),
      )
      .filter((url) => url.pathname.startsWith("/api/_inspect/"));
    expect(inspected.map((url) => url.pathname)).toEqual([
      `/api/_inspect/threads/${ALICE_THREAD}/events`,
      `/api/_inspect/threads/${ALICE_THREAD}/state`,
    ]);
    for (const url of inspected) {
      expect(url.searchParams.getAll("userId")).toEqual(["alice"]);
    }
  });
});

describe("CopilotKitIntelligence thread events and state reads", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(fakePlatform));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client() {
    return new CopilotKitIntelligence({
      apiUrl: PLATFORM,
      wsUrl: "wss://platform.test",
      apiKey: "project-key",
    });
  }

  it("refuse a missing or empty userId before calling the platform", async () => {
    // A JS caller, or one built against the earlier signature, can omit it.
    for (const userId of [undefined, ""]) {
      const params = {
        threadId: ALICE_THREAD,
        userId: userId as unknown as string,
      };
      await expect(client().getThreadEvents(params)).rejects.toThrow(TypeError);
      await expect(client().getThreadState(params)).rejects.toThrow(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
