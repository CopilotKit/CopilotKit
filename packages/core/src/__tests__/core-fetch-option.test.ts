/**
 * The `fetch` option on `CopilotKitCore`: every request Core makes goes through
 * it. React Native needs this to hand Core a streaming fetch without replacing
 * the app's global one, so a request that slips past it is a request that
 * cannot stream (or loses the app's transport) on a phone.
 *
 * The global `fetch` is stubbed to record calls in every test, so "the
 * provided fetch was used" is always paired with "the global one was not".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCore } from "../core";
import type { CopilotKitCoreConfig } from "../core";
import type { CopilotRuntimeTransport } from "../types";
import { createSuggestionsConfig, waitForCondition } from "./test-utils";

const RUNTIME_URL = "https://runtime.example/api/copilotkit";
const encoder = new TextEncoder();

interface RecordedRequest {
  url: string;
  /** REST path below the runtime URL, or the single-route envelope method. */
  route: string;
  init: RequestInit | undefined;
  receiver: unknown;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function envelopeMethod(init: RequestInit | undefined): string | undefined {
  if (typeof init?.body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(init.body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "method" in parsed &&
      typeof parsed.method === "string"
    ) {
      return parsed.method;
    }
  } catch {
    // Not an envelope (e.g. a REST run body).
  }
  return undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(events: object[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function runEvents(threadId: string): object[] {
  return [
    { type: "RUN_STARTED", threadId, runId: "run-1" },
    { type: "RUN_FINISHED", threadId, runId: "run-1" },
  ];
}

interface RuntimeOptions {
  transport: Exclude<CopilotRuntimeTransport, "auto">;
  info?: Record<string, unknown>;
}

/**
 * A fetch that answers like a CopilotKit runtime on `transport` and records
 * every call, including the receiver it was invoked with.
 */
function createRuntimeFetch({ transport, info = {} }: RuntimeOptions) {
  const requests: RecordedRequest[] = [];
  const infoBody = {
    version: "1.0.0",
    mode: "sse",
    agents: { default: { description: "Default agent" } },
    ...info,
  };
  const implementation = vi.fn(async function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = urlOf(input);
    const method = envelopeMethod(init);
    const route =
      url === RUNTIME_URL && method !== undefined
        ? method
        : url.startsWith(RUNTIME_URL)
          ? url.slice(RUNTIME_URL.length)
          : url;
    requests.push({ url, route, init, receiver: this });

    if (route === "/info") {
      return transport === "rest" ? json(infoBody) : json({}, 404);
    }
    if (route === "info") return json(infoBody);
    if (route === "/inspector-metadata" || route === "inspector/metadata") {
      return new Response(null, { status: 204 });
    }
    if (route.endsWith("/stop") || route.includes("/stop/")) return json({});
    if (route === "agent/stop") return json({});
    if (route.endsWith("/suggest")) {
      return sse([
        { type: "RUN_STARTED", threadId: "s", runId: "s" },
        { type: "RUN_FINISHED", threadId: "s", runId: "s" },
      ]);
    }
    if (route.endsWith("/connect") || route === "agent/connect") {
      return sse([]);
    }
    if (route.endsWith("/run") || route === "agent/run") {
      return sse(runEvents("thread-1"));
    }
    if (route.startsWith("/trajectory/") || route === "trajectory/connect") {
      return json({ error: { code: "TEST_STOP" } }, 400);
    }
    return json({}, 404);
  });
  return {
    fetch: implementation as unknown as typeof fetch,
    implementation,
    requests,
    routes: () => requests.map((request) => request.route),
  };
}

const cores: CopilotKitCore[] = [];

function makeCore(config: CopilotKitCoreConfig): CopilotKitCore {
  const core = new CopilotKitCore(config);
  cores.push(core);
  return core;
}

async function connected(core: CopilotKitCore): Promise<AbstractAgent> {
  await waitForCondition(() => core.getAgent("default") !== undefined, 2000);
  return core.getAgent("default")!;
}

let globalFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalFetch = vi.fn(async () => json({ unexpected: true }, 599));
  vi.stubGlobal("fetch", globalFetch);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  for (const core of cores.splice(0)) core.stopTrajectory();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CopilotKitCore fetch option", () => {
  describe.each(["rest", "single"] as const)("%s transport", (transport) => {
    it("loads /info through the provided fetch", async () => {
      const runtime = createRuntimeFetch({ transport });
      const core = makeCore({
        runtimeUrl: RUNTIME_URL,
        runtimeTransport: transport,
        fetch: runtime.fetch,
      });

      await connected(core);

      expect(runtime.routes()[0]).toBe(transport === "rest" ? "/info" : "info");
      expect(globalFetch).not.toHaveBeenCalled();
    });

    it("runs, connects and stops runtime agents through the provided fetch, with the configured credentials", async () => {
      const runtime = createRuntimeFetch({ transport });
      const core = makeCore({
        runtimeUrl: RUNTIME_URL,
        runtimeTransport: transport,
        credentials: "include",
        fetch: runtime.fetch,
      });
      const agent = await connected(core);
      agent.threadId = "thread-1";

      await core.connectAgent({ agent });
      await core.runAgent({ agent });
      agent.abortRun();
      await waitForCondition(() =>
        runtime
          .routes()
          .some((route) => route === "agent/stop" || route.includes("/stop/")),
      );

      const expected =
        transport === "rest"
          ? [
              "/agent/default/connect",
              "/agent/default/run",
              "/agent/default/stop/thread-1",
            ]
          : ["agent/connect", "agent/run", "agent/stop"];
      for (const route of expected) {
        const request = runtime.requests.find((r) => r.route === route);
        expect(
          request,
          `${route} must go through the provided fetch`,
        ).toBeDefined();
        expect(request!.init?.credentials).toBe("include");
      }
      expect(globalFetch).not.toHaveBeenCalled();
    });

    it("loads inspector metadata through the provided fetch", async () => {
      const runtime = createRuntimeFetch({
        transport,
        info: { inspectorMetadata: true },
      });
      const core = makeCore({
        runtimeUrl: RUNTIME_URL,
        runtimeTransport: transport,
        credentials: "include",
        fetch: runtime.fetch,
      });
      await connected(core);

      const route =
        transport === "rest" ? "/inspector-metadata" : "inspector/metadata";
      await waitForCondition(() => runtime.routes().includes(route));
      const request = runtime.requests.find((r) => r.route === route)!;
      expect(request.init?.credentials).toBe("include");
      expect(globalFetch).not.toHaveBeenCalled();
    });

    it("streams cloned-agent suggestions through the provided fetch", async () => {
      const runtime = createRuntimeFetch({ transport });
      const core = makeCore({
        runtimeUrl: RUNTIME_URL,
        runtimeTransport: transport,
        fetch: runtime.fetch,
      });
      await connected(core);
      core.addSuggestionsConfig(
        createSuggestionsConfig({
          providerAgentId: "default",
          consumerAgentId: "default",
        }),
      );

      core.reloadSuggestions("default");

      const runRoute =
        transport === "rest" ? "/agent/default/run" : "agent/run";
      await waitForCondition(() => runtime.routes().includes(runRoute));
      expect(globalFetch).not.toHaveBeenCalled();
    });
  });

  it("auto-detects the transport through the provided fetch", async () => {
    const runtime = createRuntimeFetch({ transport: "single" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "auto",
      fetch: runtime.fetch,
    });

    await connected(core);

    expect(runtime.routes().slice(0, 2)).toEqual(["/info", "info"]);
    expect(core.runtimeTransport).toBe("single");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("streams stateless suggestions from /suggest through the provided fetch, with the configured credentials", async () => {
    const runtime = createRuntimeFetch({
      transport: "rest",
      info: { suggestions: true },
    });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      credentials: "include",
      fetch: runtime.fetch,
    });
    await connected(core);
    await waitForCondition(() => core.suggestions === true);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "default",
      }),
    );

    core.reloadSuggestions("default");

    await waitForCondition(() =>
      runtime.routes().includes("/agent/default/suggest"),
    );
    const request = runtime.requests.find(
      (r) => r.route === "/agent/default/suggest",
    )!;
    expect(request.init?.credentials).toBe("include");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("starts learning capture through the provided fetch", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("document", { title: "Synthetic app", referrer: "" });
    vi.stubGlobal("location", new URL("https://app.invalid/page"));
    const runtime = createRuntimeFetch({ transport: "single" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "single",
      deferInitialConnection: true,
      credentials: "include",
      fetch: runtime.fetch,
      learning: {
        capture: {
          clicks: false,
          navigation: false,
          inputs: false,
          network: false,
        },
        onError: () => {},
      },
    });

    void core.startTrajectory({ trajectoryId: "trajectory-1" });

    await waitForCondition(() =>
      runtime.routes().includes("trajectory/connect"),
    );
    const request = runtime.requests.find(
      (r) => r.route === "trajectory/connect",
    )!;
    expect(request.init?.credentials).toBe("include");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("shares the provided fetch with thread, memory and learning resource requests", async () => {
    const runtime = createRuntimeFetch({ transport: "rest" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      fetch: runtime.fetch,
    });
    await connected(core);

    await core.ɵruntimeFetch(`${RUNTIME_URL}/threads?agentId=default`);

    expect(runtime.routes()).toContain("/threads?agentId=default");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("exposes the provided fetch for framework requests such as transcription", async () => {
    const runtime = createRuntimeFetch({ transport: "rest" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
      fetch: runtime.fetch,
    });

    expect(core.fetch).toBe(runtime.fetch);
    await core.ɵfetch(`${RUNTIME_URL}/transcribe`, { method: "POST" });

    expect(runtime.routes()).toEqual(["/transcribe"]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("calls the provided fetch without a receiver, as native fetch requires", async () => {
    const runtime = createRuntimeFetch({ transport: "rest" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      fetch: runtime.fetch,
    });
    const agent = await connected(core);
    agent.threadId = "thread-1";

    await core.runAgent({ agent });
    agent.abortRun();
    await waitForCondition(() =>
      runtime.routes().includes("/agent/default/stop/thread-1"),
    );

    // A browser's `window.fetch` throws "Illegal invocation" when called as a
    // method of anything but `window`.
    expect(runtime.requests.map((request) => request.receiver)).toEqual(
      runtime.requests.map(() => undefined),
    );
  });

  it("uses a fetch swapped in with setFetch for later requests", async () => {
    const first = createRuntimeFetch({ transport: "rest" });
    const second = createRuntimeFetch({ transport: "rest" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      fetch: first.fetch,
    });
    const agent = await connected(core);

    core.setFetch(second.fetch);
    await core.runAgent({ agent });

    expect(core.fetch).toBe(second.fetch);
    expect(first.routes()).not.toContain("/agent/default/run");
    expect(second.routes()).toContain("/agent/default/run");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("defaults to the global fetch, looked up when each request is made", async () => {
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    // Installed after construction, the way a late polyfill or test stub is.
    const runtime = createRuntimeFetch({ transport: "rest" });
    vi.stubGlobal("fetch", runtime.fetch);

    core.connect();
    const agent = await connected(core);
    await core.runAgent({ agent });

    expect(core.fetch).toBeUndefined();
    expect(runtime.routes()).toEqual(["/info", "/agent/default/run"]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("goes back to the global fetch when setFetch clears the option", async () => {
    const provided = createRuntimeFetch({ transport: "rest" });
    const core = makeCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      fetch: provided.fetch,
    });
    const agent = await connected(core);
    const global = createRuntimeFetch({ transport: "rest" });
    vi.stubGlobal("fetch", global.fetch);

    core.setFetch(undefined);
    await core.runAgent({ agent });

    expect(core.fetch).toBeUndefined();
    expect(global.routes()).toEqual(["/agent/default/run"]);
  });
});
