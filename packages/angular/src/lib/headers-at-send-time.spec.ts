/**
 * #1937: the headers builder is evaluated when a request is SENT, not during
 * construction/config time. Mirrors
 * `react-core/src/v2/providers/__tests__/CopilotKitProvider.headersAtSendTime.test.tsx`
 * and
 * `vue/src/v2/providers/__tests__/CopilotKitProvider.headersAtSendTime.test.ts`.
 * See `implementer-rules.md` and `task-7-brief.md` for the contract this
 * guards.
 */
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import type { CopilotKitHeadersSource } from "@copilotkit/core";
import { provideCopilotKit } from "./config";
import type { CopilotKitConfig } from "./config";
import { CopilotKit } from "./copilotkit";
import { injectAgentStore } from "./agent";
import { injectThreads } from "./threads";
import { transcribeAudio } from "./transcription";
import { ɵheadersAsyncBuilderCompiles } from "./headers-source.type-check";

type Call = { url: string; auth: string | null; publicApiKey: string | null };

function stubFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers ?? (input as Request).headers);
    calls.push({
      url,
      auth: headers.get("authorization"),
      publicApiKey: headers.get("x-copilotcloud-public-api-key"),
    });
    let body: unknown = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {
      // Non-JSON body (e.g. connect/transcribe form data) — irrelevant here.
    }
    const method = (body as { method?: string }).method;
    if (url.endsWith("/info") || method === "info") {
      return new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: { default: { name: "default", description: "" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/threads?")) {
      return new Response(JSON.stringify({ threads: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/transcribe")) {
      return new Response(
        JSON.stringify({ text: "hi", size: 1, type: "audio/webm" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // A non-2xx here would read as a runtime health signal (core re-probes
    // /info on a failed request while Connected). The run/connect body itself
    // is irrelevant to every assertion here (only request headers are
    // inspected), so keep every other request a plain 200.
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

let token = "tok-1";

afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
  token = "tok-1";
});

/** Poll a predicate for about `ms`, flushing Angular's zone each tick. */
async function pollFor(predicate: () => boolean, ms = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function configureCopilotKit(config: CopilotKitConfig): CopilotKit {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideCopilotKit(config)],
  });
  return TestBed.inject(CopilotKit);
}

describe("CopilotKit — headers builder evaluated at send time (#1937)", () => {
  it("a run carries the builder's current token after nothing about the config changed", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const copilotkit = configureCopilotKit({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: (() => ({
        Authorization: `Bearer ${token}`,
      })) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() =>
      expect(copilotkit.core.getAgent("default")).toBeDefined(),
    );
    const callsBeforeRun = calls.length;

    // Token rotates (e.g. a Clerk re-mint). Nothing about the config changes
    // — no re-construction exists to eagerly re-resolve.
    token = "tok-2";

    const agent = copilotkit.core.getAgent("default")!;
    await copilotkit.core.runAgent({ agent }).catch(() => {});

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it("an async builder is awaited", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const copilotkit = configureCopilotKit({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { Authorization: `Bearer ${token}` };
      }) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() =>
      expect(copilotkit.core.getAgent("default")).toBeDefined(),
    );
    const callsBeforeRun = calls.length;

    token = "tok-2";

    const agent = copilotkit.core.getAgent("default")!;
    await copilotkit.core.runAgent({ agent }).catch(() => {});

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it("copilotkit.headers() updates on a source change (updateRuntime) but NOT on a builder's per-request resolution (accepted gap, #1937)", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const copilotkit = configureCopilotKit({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: { Authorization: "Bearer static-1" } as CopilotKitHeadersSource,
    });

    await vi.waitFor(() =>
      expect(copilotkit.core.getAgent("default")).toBeDefined(),
    );
    expect(copilotkit.headers()).toEqual({ Authorization: "Bearer static-1" });

    // `updateRuntime` is the framework-level request to change the headers
    // source. The signal reflects core's resolved snapshot right after it —
    // never a stale copy of the caller-supplied source itself (which, for a
    // builder, wouldn't even be a record).
    copilotkit.updateRuntime({
      headers: { Authorization: "Bearer static-2" },
    });
    expect(copilotkit.headers()).toEqual({ Authorization: "Bearer static-2" });

    // Documents the intended contract (see `CopilotKit.headers`'s JSDoc): a
    // builder resolving a FRESH token during a run is NOT a source change, so
    // it must NOT touch this signal — even though the actual wire request
    // (proven by the first two tests in this file) already carries the fresh
    // token via `resolveHeaders()`/`ɵruntimeFetch`. A builder consumer who
    // wants the current value must read `copilotkit.core.resolveHeaders()`,
    // not this signal.
    const builderCopilotkit = configureCopilotKit({
      runtimeUrl: "http://rt2.test/api/copilotkit",
      headers: (() => ({
        Authorization: `Bearer ${token}`,
      })) as CopilotKitHeadersSource,
    });
    await vi.waitFor(() =>
      expect(builderCopilotkit.core.getAgent("default")).toBeDefined(),
    );
    const headersBeforeRun = builderCopilotkit.headers();

    token = "tok-2";
    const builderAgent = builderCopilotkit.core.getAgent("default")!;
    await builderCopilotkit.core
      .runAgent({ agent: builderAgent })
      .catch(() => {});

    expect(builderCopilotkit.headers()).toEqual(headersBeforeRun);
  });

  it("a provisional proxy's first connect carries the fresh token", async () => {
    const calls: Call[] = [];
    let releaseInfo!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers(
          init?.headers ?? (input as Request).headers,
        );
        calls.push({
          url,
          auth: headers.get("authorization"),
          publicApiKey: headers.get("x-copilotcloud-public-api-key"),
        });
        if (url.endsWith("/info")) {
          // Held open: the runtime stays Connecting, so `injectAgentStore`
          // hands back a provisional `ProxiedCopilotRuntimeAgent` instead of
          // the real synced one.
          return new Promise<Response>((resolve) => {
            releaseInfo = resolve;
          });
        }
        return new Response("", { status: 200 });
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "http://rt.test/api/copilotkit",
          headers: (() => ({
            Authorization: `Bearer ${token}`,
          })) as CopilotKitHeadersSource,
        }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);

    @Component({ standalone: true, template: "" })
    class Host {
      readonly store = injectAgentStore("default");
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(copilotkit.core.getAgent("default")).toBeUndefined();
    const proxiedAgent = fixture.componentInstance.store()
      .agent as ProxiedCopilotRuntimeAgent;
    expect(proxiedAgent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);

    token = "tok-2";
    const callsBeforeConnect = calls.length;

    // Call the proxy's OWN installed fetch directly — this is exactly what a
    // real `/agent/default/connect` send does. `applyHeadersToAgent`
    // installed this as `ɵruntimeFetch` when the provisional was
    // constructed, so it resolves headers fresh on every call, never a
    // baked-in snapshot from construction time.
    await proxiedAgent.fetch(
      "http://rt.test/api/copilotkit/agent/default/connect",
      { method: "POST" },
    );

    const connectCalls = calls.slice(callsBeforeConnect);
    expect(connectCalls.length).toBeGreaterThan(0);
    expect(connectCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
    // `releaseInfo` is intentionally never called: this test only needs the
    // runtime held in "Connecting" long enough to observe the provisional
    // proxy's own fetch.
    void releaseInfo;
  });

  it("changing the headers config from one record to a different record re-dispatches the thread context exactly once", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "http://rt.test/api/copilotkit",
          headers: {
            Authorization: "Bearer static-1",
          } as CopilotKitHeadersSource,
        }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "default" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    await vi.waitFor(() =>
      expect(copilotkit.core.getAgent("default")).toBeDefined(),
    );
    fixture.detectChanges();
    const store = await vi.waitFor(() => {
      const s = copilotkit.core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });

    // Wait for the first (mount) context dispatch before spying, so the spy
    // only observes dispatches caused by the config change below.
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");

    // A record-to-record change (the case a strict-reference `setSource`
    // dedup can't collapse) — one real source change, one `onHeadersChanged`.
    copilotkit.updateRuntime({
      headers: { Authorization: "Bearer static-2" },
    });
    fixture.detectChanges();

    // Settle before asserting "exactly once": don't let a poll return on the
    // first observed call while a second (spurious) dispatch is still
    // in-flight.
    await pollFor(() => setContextSpy.mock.calls.length > 0, 200);
    fixture.detectChanges();
    await pollFor(() => false, 50);

    expect(setContextSpy).toHaveBeenCalledTimes(1);
  });

  it("an unrelated change, and a token rotation followed by a run, re-dispatch the thread context 0 times", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideCopilotKit({
          runtimeUrl: "http://rt.test/api/copilotkit",
          headers: (() => ({
            Authorization: `Bearer ${token}`,
          })) as CopilotKitHeadersSource,
        }),
      ],
    });
    const copilotkit = TestBed.inject(CopilotKit);

    @Component({ standalone: true, template: "" })
    class Host {
      readonly threads = injectThreads({ agentId: "default" });
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    await vi.waitFor(() =>
      expect(copilotkit.core.getAgent("default")).toBeDefined(),
    );
    fixture.detectChanges();
    const store = await vi.waitFor(() => {
      const s = copilotkit.core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });

    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");

    // An unrelated config change (no header source change at all).
    copilotkit.updateRuntime({ properties: { locale: "en" } });
    fixture.detectChanges();
    await pollFor(() => false, 50);
    expect(setContextSpy).toHaveBeenCalledTimes(0);

    // A token rotation: nothing about the source changes (still the same
    // builder function), only the value it will next return. A run actually
    // resolves it (routes through `ɵruntimeFetch`), so the snapshot really
    // does change — but that must not re-dispatch the thread context.
    token = "tok-2";
    const agent = copilotkit.core.getAgent("default")!;
    await copilotkit.core.runAgent({ agent }).catch(() => {});
    fixture.detectChanges();
    await pollFor(() => false, 50);

    expect(setContextSpy).toHaveBeenCalledTimes(0);
  });

  it("transcribeAudio never re-sends a stale header snapshot key (#1937)", async () => {
    const calls: Call[] = [];
    let signedIn = true;
    vi.stubGlobal("fetch", stubFetch(calls));

    const copilotkit = configureCopilotKit({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: (() =>
        signedIn
          ? { Authorization: "Bearer x" }
          : {}) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() =>
      expect(copilotkit.core.getAgent("default")).toBeDefined(),
    );

    // Force an actual resolution while signed in, so the header source's
    // last snapshot is non-empty — otherwise a stale-merge bug has nothing
    // stale to leak, and the assertion below would pass vacuously.
    await transcribeAudio(
      copilotkit.core,
      new Blob(["a"], { type: "audio/webm" }),
    );
    const firstCall = calls.find((c) => c.url.endsWith("/transcribe"));
    expect(firstCall?.auth).toBe("Bearer x");

    calls.length = 0;
    signedIn = false;

    await transcribeAudio(
      copilotkit.core,
      new Blob(["a"], { type: "audio/webm" }),
    );
    const secondCall = calls.find((c) => c.url.endsWith("/transcribe"));
    expect(secondCall).toBeDefined();
    expect(secondCall!.auth).toBeNull();
  });

  it("type: an async headers builder compiles in CopilotKitConfig", () => {
    // The compile-time half of this guarantee lives in
    // `headers-source.type-check.ts` — a plain `.ts` file, not `.spec.ts`,
    // because `tsconfig.json` excludes spec files from the `check-types`
    // compile, so an inline type assertion here would never actually be
    // checked by `tsc`.
    expect(typeof ɵheadersAsyncBuilderCompiles.headers).toBe("function");
  });
});
