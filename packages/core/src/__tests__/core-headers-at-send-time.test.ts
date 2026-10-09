import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitCore } from "../core";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { waitForCondition } from "./test-utils";

type Call = { url: string; auth: string | null };

function recordingFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/info")) {
      return new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: { default: { name: "default", description: "" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("no", { status: 401 });
  });
}

describe("headers at send time", () => {
  const realFetch = global.fetch;
  const realWindow = (global as any).window;
  let calls: Call[];
  beforeEach(() => {
    calls = [];
    (global as any).window = {};
    global.fetch = recordingFetch(calls) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    (global as any).window = realWindow;
  });

  it("a runtime run carries the token current at send time (the #1937 probe)", async () => {
    let token = "tok-1";
    const core = new CopilotKitCore({
      runtimeUrl: "http://rt.test/api",
      headers: () => ({ Authorization: `Bearer ${token}` }),
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    token = "tok-2";
    await core.runAgent({ agent: core.getAgent("default")! }).catch(() => {});
    const run = calls.find((c) => c.url.includes("/agent/default/run"));
    expect(run?.auth).toBe("Bearer tok-2");
  });

  it("a removed key is not sent from a stale snapshot", async () => {
    let signedIn = true;
    const core = new CopilotKitCore({
      runtimeUrl: "http://rt.test/api",
      headers: () => (signedIn ? { Authorization: "Bearer x" } : {}),
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    // Force an actual resolution while signed in, so the header source's last
    // snapshot is non-empty — otherwise a stale-merge bug has nothing stale
    // to leak, and the assertion below would pass vacuously.
    await core.runAgent({ agent: core.getAgent("default")! }).catch(() => {});
    expect(calls.find((c) => c.url.includes("/agent/default/run"))?.auth).toBe(
      "Bearer x",
    );
    calls.length = 0;
    signedIn = false;
    await core.runAgent({ agent: core.getAgent("default")! }).catch(() => {});
    const run = calls.find((c) => c.url.includes("/agent/default/run"));
    expect(run).toBeDefined();
    expect(run!.auth).toBeNull();
  });

  it("a user-supplied HttpAgent gets headers resolved right before its run", async () => {
    const agent = new HttpAgent({
      url: "http://other.test/agent",
      headers: { "X-Own": "1" },
    });
    let token = "a";
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { mine: agent },
      headers: async () => ({ Authorization: token }),
    });
    token = "b";
    await core.runAgent({ agent: core.getAgent("mine")! }).catch(() => {});
    const run = calls.find((c) => c.url === "http://other.test/agent");
    expect(run?.auth).toBe("b");
  });

  it("no added await: runAgent's synchronous side effects precede its first real await for a sync builder", () => {
    const agent = new HttpAgent({ url: "http://other.test/agent" });
    // `detachActiveRun` is the statement immediately after header application
    // in `runAgent`. For a sync builder, applying headers must not insert an
    // await: the call to `detachActiveRun` (runAgent's first real async step)
    // has to happen in the SAME synchronous tick as invoking `runAgent`, not
    // deferred to the next microtask.
    const detachSpy = vi.spyOn(agent, "detachActiveRun");
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { mine: agent },
      headers: () => ({ Authorization: "s" }),
    });
    void core.runAgent({ agent: core.getAgent("mine")! }).catch(() => {});
    // prepareAgentHeadersForRun already ran synchronously: headers are
    // current...
    expect(agent.headers).toMatchObject({ Authorization: "s" });
    // ...and runAgent has already reached (called) its next synchronous step,
    // proving no extra microtask was inserted between the two. Awaiting the
    // (undefined) return value unconditionally would suspend here instead and
    // defer this call to the next microtask, which this assertion catches.
    expect(detachSpy).toHaveBeenCalled();
  });

  it("applyHeadersToAgent gives a bare proxied agent the runtime fetch and only its own headers", () => {
    const core = new CopilotKitCore({
      deferInitialConnection: true,
      runtimeUrl: "http://rt.test/api",
      headers: { Authorization: "core" },
    });
    const proxy = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://rt.test/api",
      agentId: "p",
      headers: { "X-Own": "1" },
    });
    core.applyHeadersToAgent(proxy);
    expect(proxy.headers).toEqual({ "X-Own": "1" });
    expect(proxy.fetch).toBe(core.ɵruntimeFetch);
  });

  it("the public applyHeadersToAgent never calls the headers builder, even one that throws — for a plain HttpAgent or a proxied agent", () => {
    // `applyHeadersToAgent` is reachable from
    // anywhere (a dev-only registration helper, a React effect that re-runs
    // on every render), so it must never invoke a user-supplied builder — a
    // sync throw there would propagate out of the caller, and an async
    // rejection would be unhandled. Only the friends-only
    // `prepareAgentHeadersForRun` (used by the run/connect path, which can
    // await and report a failure) may call it.
    const builder = vi.fn((): Record<string, string> => {
      throw new Error("boom");
    });
    const core = new CopilotKitCore({
      deferInitialConnection: true,
      runtimeUrl: "http://rt.test/api",
      headers: builder,
    });
    const httpAgent = new HttpAgent({ url: "http://other.test/agent" });
    const proxy = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://rt.test/api",
      agentId: "p",
    });
    expect(() => core.applyHeadersToAgent(httpAgent)).not.toThrow();
    expect(() => core.applyHeadersToAgent(proxy)).not.toThrow();
    expect(builder).toHaveBeenCalledTimes(0);
  });

  it("addAgent__unsafe_dev_only does not call a throwing headers builder", () => {
    // The exact call site the review flagged (agent-registry.ts's
    // `addAgent__unsafe_dev_only`, reached from `CopilotKitCore
    // .addAgent__unsafe_dev_only` and mirrored by react-core's
    // `use-agent.tsx`'s provisional-proxy registration): registering an
    // agent must not invoke the builder at all, so a throwing builder can
    // never break registration.
    const builder = vi.fn((): Record<string, string> => {
      throw new Error("boom");
    });
    const core = new CopilotKitCore({ headers: builder });
    builder.mockClear();
    const agent = new HttpAgent({ url: "http://other.test/agent" });
    expect(() =>
      core.addAgent__unsafe_dev_only({ id: "mine", agent }),
    ).not.toThrow();
    expect(builder).toHaveBeenCalledTimes(0);
  });

  it("a stop request carries the current token", async () => {
    let token = "tok-1";
    const core = new CopilotKitCore({
      runtimeUrl: "http://rt.test/api",
      headers: () => ({ Authorization: `Bearer ${token}` }),
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    const agent = core.getAgent("default")!;
    agent.threadId = "thread-1";
    token = "tok-2";
    agent.abortRun();
    await waitForCondition(() => calls.some((c) => c.url.includes("/stop/")));
    const stop = calls.find((c) => c.url.includes("/stop/"));
    expect(stop?.auth).toBe("Bearer tok-2");
  });

  it("a builder failure during a run emits exactly one error and sends nothing", async () => {
    const agent = new HttpAgent({ url: "http://other.test/agent" });
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { mine: agent },
      headers: async () => {
        throw new Error("x");
      },
    });
    const onError = vi.fn();
    core.subscribe({ onError });
    const result = await core.runAgent({ agent: core.getAgent("mine")! });
    expect(result).toEqual({ result: undefined, newMessages: [] });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].code).toBe("header_resolution_failed");
    expect(calls.some((c) => c.url === "http://other.test/agent")).toBe(false);
  });
});
