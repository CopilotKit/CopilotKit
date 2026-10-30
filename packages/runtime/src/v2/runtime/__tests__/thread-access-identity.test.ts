/**
 * How the runtime calls `identifyUser` on the local Thread routes.
 */
import { describe, expect, it, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import type { CopilotRuntimeLike, IdentifyUserCallback } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { resolveIntelligenceUser } from "../handlers/shared/resolve-intelligence-user";
import {
  BASE,
  get,
  headersFor,
  isolateThreadStore,
  makeHandler,
  post,
  runBody,
  testAgents,
  uniqueThreadId,
} from "./helpers/thread-access-harness";

isolateThreadStore();

describe("identifyUser on SSE runtimes (T9)", () => {
  it("can read the request body on run and connect, as on stop", async () => {
    // An identity that comes from the signed request body, not a header.
    const identifyFromBody = async (request: Request) => {
      const body = (await request.json()) as {
        forwardedProps?: { user?: string };
      };
      const id = body.forwardedProps?.user;
      if (!id) throw new Error("no user in body");
      return { id, name: id };
    };
    const handler = makeHandler({ identifyUser: identifyFromBody });
    const threadId = uniqueThreadId("t9-body");
    const body = JSON.stringify({
      ...JSON.parse(runBody(threadId, "BODY_SECRET")),
      forwardedProps: { user: "alice" },
    });

    const run = await handler(
      new Request(`${BASE}/agent/secret/run`, {
        method: "POST",
        headers: headersFor(),
        body,
      }),
    );
    expect(run.status).toBe(200);
    expect(await run.text()).toContain("RUN_FINISHED");

    const connect = await handler(
      new Request(`${BASE}/agent/secret/connect`, {
        method: "POST",
        headers: headersFor(),
        body,
      }),
    );
    expect(connect.status).toBe(200);
    expect(await connect.text()).toContain("BODY_SECRET");
  });

  it("does not require a user name, which only Intelligence uses", async () => {
    const handler = makeHandler({
      identifyUser: (request: Request) => ({
        id: request.headers.get("x-test-user") ?? "nobody",
        name: "",
      }),
    });
    const threadId = uniqueThreadId("t9-noname");
    const run = await post(
      handler,
      "/agent/secret/run",
      "alice",
      runBody(threadId, "NO_NAME"),
    );
    expect(run.status).toBe(200);
    expect(await run.text()).toContain("RUN_FINISHED");
    const list = await get(handler, "/threads", "alice");
    expect(list.status).toBe(200);
  });

  it("logs a failing identifyUser without calling it an Intelligence error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const handler = makeHandler({
        identifyUser: () => {
          throw new Error("session expired");
        },
      });
      const response = await get(handler, "/threads", "alice");
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Failed to identify user",
      });
      const labels = error.mock.calls.map((call) => String(call[0]));
      expect(labels).toContain("Error identifying user:");
      expect(labels.join(" ")).not.toMatch(/intelligence/i);
    } finally {
      error.mockRestore();
    }
  });

  it("accepts only runtimes that have identifyUser (compile-time check)", () => {
    // Never called: it exists so `tsc` rejects a runtime without identifyUser.
    const check = (runtime: CopilotRuntimeLike, request: Request) =>
      // @ts-expect-error identifyUser is optional on CopilotRuntimeLike
      resolveIntelligenceUser({ runtime, request });
    expect(typeof check).toBe("function");
  });
});

describe("an identifyUser that is not a function", () => {
  it("is rejected when the runtime is constructed", () => {
    for (const identifyUser of [null, "alice", { id: "alice" }]) {
      expect(
        () =>
          new CopilotRuntime({
            agents: testAgents(),
            identifyUser: identifyUser as unknown as IdentifyUserCallback,
          }),
      ).toThrow(/identifyUser/);
    }
  });

  it("counts as no identity on every Thread route of an external runtime", async () => {
    // An external CopilotRuntimeLike can carry any value; it must not open
    // list and clear to anonymous callers in the default mode.
    const runtime = new CopilotRuntime({ agents: testAgents() });
    Object.defineProperty(runtime, "identifyUser", { value: null });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
    });
    expect((await get(handler, "/threads")).status).toBe(403);
    expect((await post(handler, "/threads/clear")).status).toBe(403);
  });
});
