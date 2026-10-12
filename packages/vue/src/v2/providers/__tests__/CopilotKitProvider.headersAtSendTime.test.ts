/**
 * #1937: the headers builder is evaluated when a request is SENT, not during
 * render/setup. Mirrors
 * `react-core/src/v2/providers/__tests__/CopilotKitProvider.headersAtSendTime.test.tsx`.
 */
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import type { CopilotKitHeadersSource } from "@copilotkit/core";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import { useAgent } from "../../hooks/use-agent";
import { useThreads } from "../../hooks/use-threads";
import { transcribeAudio } from "../../lib/transcription-client";
import type { CopilotKitCoreVue } from "../../lib/vue-core";

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
    // A non-2xx here would read as a runtime health signal (core re-probes
    // /info on a failed request while Connected). The run/connect body
    // itself is irrelevant to every assertion here (only request headers are
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
  token = "tok-1";
});

/** Poll a predicate for about `ms`, flushing Vue's reactivity each tick. */
async function pollFor(predicate: () => boolean, ms = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate()) return;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function mountCore(props: Record<string, unknown>): {
  getCore: () => CopilotKitCoreVue;
  wrapper: ReturnType<typeof mount>;
} {
  let core: CopilotKitCoreVue | undefined;
  const Probe = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit.value;
      return () => null;
    },
  });

  const wrapper = mount(CopilotKitProvider, {
    props,
    slots: { default: () => h(Probe) },
  });

  return {
    wrapper,
    getCore: () => {
      if (!core) throw new Error("CopilotKit core not available");
      return core;
    },
  };
}

describe("CopilotKitProvider — headers builder evaluated at send time (#1937)", () => {
  it("a run carries the builder's current token when nothing about the provider changed", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const { getCore } = mountCore({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: (() => ({
        Authorization: `Bearer ${token}`,
      })) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() => expect(getCore().getAgent("default")).toBeDefined());
    const callsBeforeRun = calls.length;

    // Token rotates (e.g. a Clerk re-mint). Nothing about the provider's
    // props changes — no re-render/re-setup exists to eagerly re-resolve.
    token = "tok-2";

    const agent = getCore().getAgent("default")!;
    await getCore()
      .runAgent({ agent })
      .catch(() => {});

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it("an async builder is awaited", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const { getCore } = mountCore({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { Authorization: `Bearer ${token}` };
      }) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() => expect(getCore().getAgent("default")).toBeDefined());
    const callsBeforeRun = calls.length;

    token = "tok-2";

    const agent = getCore().getAgent("default")!;
    await getCore()
      .runAgent({ agent })
      .catch(() => {});

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
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
          // Held open: the runtime stays Connecting, so `useAgent` hands
          // back a provisional `ProxiedCopilotRuntimeAgent` instead of the
          // real synced one.
          return new Promise<Response>((resolve) => {
            releaseInfo = resolve;
          });
        }
        return new Response("", { status: 200 });
      }),
    );

    let agentRef!: {
      headers?: Record<string, string>;
      fetch: typeof fetch;
    };
    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "default" });
        agentRef = agent.value as unknown as typeof agentRef;
        return () => null;
      },
    });

    let core!: CopilotKitCoreVue;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    mount(CopilotKitProvider, {
      props: {
        runtimeUrl: "http://rt.test/api/copilotkit",
        headers: (() => ({
          Authorization: `Bearer ${token}`,
        })) as CopilotKitHeadersSource,
      },
      slots: { default: () => [h(Child), h(Probe)] },
    });

    await nextTick();
    expect(core.getAgent("default")).toBeUndefined();

    token = "tok-2";
    const callsBeforeConnect = calls.length;

    // Call the proxy's OWN installed fetch directly — this is exactly what a
    // real `/agent/default/connect` send does, without pulling in the
    // AG-UI stream-parsing machinery a fabricated empty response can't
    // satisfy. `applyHeadersToAgent` installed this as `ɵruntimeFetch` when
    // the provisional was constructed, so it resolves headers fresh on
    // every call, never a baked-in snapshot from construction time.
    await agentRef.fetch(
      "http://rt.test/api/copilotkit/agent/default/connect",
      {
        method: "POST",
      },
    );

    const connectCalls = calls.slice(callsBeforeConnect);
    expect(connectCalls.length).toBeGreaterThan(0);
    expect(connectCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
    // `releaseInfo` is intentionally never called: this test only needs the
    // runtime held in "Connecting" long enough to observe the provisional
    // proxy's own fetch.
    void releaseInfo;
  });

  it.each([
    { label: "no publicApiKey", publicApiKey: undefined },
    // With a publicApiKey, `ɵwithHeaderDefaults` is no longer a passthrough:
    // it wraps the builder in a NEW closure on every call (non-empty
    // defaults), so this row is the one that actually exercises the memo —
    // the plain-builder row above still passes even without it, because
    // `ɵwithHeaderDefaults` returns the source unchanged when there is
    // nothing to fill in.
    { label: "with publicApiKey (Cloud)", publicApiKey: "pk_test_123" },
  ])(
    "inline builder across 20 prop updates: 0 extra setHeaders ($label)",
    async ({ publicApiKey }) => {
      const calls: Call[] = [];
      vi.stubGlobal("fetch", stubFetch(calls));

      const { getCore, wrapper } = mountCore({
        runtimeUrl: "http://rt.test/api/copilotkit",
        publicApiKey,
        headers: (() => ({
          Authorization: `Bearer ${token}`,
        })) as CopilotKitHeadersSource,
      });

      await vi.waitFor(() =>
        expect(getCore().getAgent("default")).toBeDefined(),
      );

      const setHeadersSpy = vi.spyOn(getCore(), "setHeaders");

      for (let i = 0; i < 20; i++) {
        // A NEW inline arrow every update: identity churns even though the
        // builder's behavior never does.
        await wrapper.setProps({
          headers: (() => ({
            Authorization: `Bearer ${token}`,
          })) as CopilotKitHeadersSource,
        });
      }

      await pollFor(() => false, 30);

      expect(setHeadersSpy).toHaveBeenCalledTimes(0);
    },
  );

  it("the public API key header is added when headers omit it", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    mountCore({
      runtimeUrl: "http://rt.test/api/copilotkit",
      publicApiKey: "pk_test_123",
      headers: (() => ({})) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() => {
      const infoCall = calls.find((c) => c.url.endsWith("/info"));
      expect(infoCall).toBeDefined();
      expect(infoCall?.publicApiKey).toBe("pk_test_123");
    });
  });

  it("a token change does not re-dispatch the thread context", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const Threads = defineComponent({
      setup() {
        useThreads({ agentId: "default" });
        return () => null;
      },
    });

    let core!: CopilotKitCoreVue;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    mount(CopilotKitProvider, {
      props: {
        runtimeUrl: "http://rt.test/api/copilotkit",
        headers: (() => ({
          Authorization: `Bearer ${token}`,
        })) as CopilotKitHeadersSource,
      },
      slots: { default: () => [h(Threads), h(Probe)] },
    });

    await vi.waitFor(() => expect(core.getAgent("default")).toBeDefined());

    const store = await vi.waitFor(() => {
      const s = core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });

    // Wait for the first (mount) context dispatch before spying, so the spy
    // only observes dispatches caused by the token rotation below.
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");

    token = "tok-2";
    // A run actually changes the resolved snapshot (routes through
    // `ɵruntimeFetch`, which resolves the builder's now-current token) — a
    // rotation nobody ever reads is not a real test of "the snapshot changed
    // but nothing re-dispatched".
    const agent = core.getAgent("default")!;
    await core.runAgent({ agent }).catch(() => {});

    // Force a Vue-level trigger entirely unrelated to headers. The OLD
    // values-keyed `headersKey` would have re-evaluated (and seen the
    // now-changed snapshot) the next time ANYTHING pokes Vue's reactivity
    // around `copilotkit` — this is that poke.
    core.setRenderToolCalls([]);
    await pollFor(() => false, 50);

    expect(setContextSpy).toHaveBeenCalledTimes(0);
  });

  it("transcribeAudio never re-sends a stale header snapshot key (#1937)", async () => {
    const calls: Call[] = [];
    let signedIn = true;
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
          publicApiKey: null,
        });
        if (url.endsWith("/info")) {
          return new Response(
            JSON.stringify({
              version: "1.0.0",
              agents: { default: { name: "default", description: "" } },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/transcribe")) {
          return new Response(
            JSON.stringify({ text: "hi", size: 1, type: "audio/webm" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const { getCore } = mountCore({
      runtimeUrl: "http://rt.test/api/copilotkit",
      headers: (() =>
        signedIn
          ? { Authorization: "Bearer x" }
          : {}) as CopilotKitHeadersSource,
    });

    await vi.waitFor(() => expect(getCore().getAgent("default")).toBeDefined());

    // Force an actual resolution while signed in, so the header source's
    // last snapshot is non-empty — otherwise a stale-merge bug has nothing
    // stale to leak, and the assertion below would pass vacuously.
    await transcribeAudio(getCore(), new Blob(["a"], { type: "audio/webm" }));
    const firstCall = calls.find((c) => c.url.endsWith("/transcribe"));
    expect(firstCall?.auth).toBe("Bearer x");

    calls.length = 0;
    signedIn = false;

    await transcribeAudio(getCore(), new Blob(["a"], { type: "audio/webm" }));
    const secondCall = calls.find((c) => c.url.endsWith("/transcribe"));
    expect(secondCall).toBeDefined();
    expect(secondCall!.auth).toBeNull();
  });

  it("a plain HttpAgent's headers refresh via applyHeadersToAgent when ɵheadersGeneration changes, not on header VALUES alone", async () => {
    const directAgent = new HttpAgent({ url: "http://direct.test/agent" });

    let agentRef!: { headers?: Record<string, string> };
    const Child = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "direct" });
        agentRef = agent.value as unknown as typeof agentRef;
        return () => null;
      },
    });

    const { getCore } = (() => {
      let core!: CopilotKitCoreVue;
      const Probe = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          core = copilotkit.value;
          return () => null;
        },
      });
      mount(CopilotKitProvider, {
        props: {
          agents__unsafe_dev_only: { direct: directAgent },
          headers: {
            Authorization: "Bearer static-1",
          } as CopilotKitHeadersSource,
        },
        slots: { default: () => [h(Child), h(Probe)] },
      });
      return { getCore: () => core };
    })();

    await nextTick();
    expect(agentRef.headers?.Authorization).toBe("Bearer static-1");

    // Mutate the resolved snapshot IN PLACE — no `setHeaders()`, so
    // `ɵheadersGeneration` never bumps. The watcher must not react to this:
    // it is keyed on the generation, never on header VALUES.
    getCore().headers.Authorization = "Bearer mutated-in-place";
    await nextTick();
    expect(agentRef.headers?.Authorization).toBe("Bearer static-1");

    // A real `setHeaders()` bumps `ɵheadersGeneration` — THAT is what the
    // watcher is keyed on, and it re-applies via `applyHeadersToAgent`.
    getCore().setHeaders({ Authorization: "Bearer static-2" });
    await nextTick();

    expect(agentRef.headers?.Authorization).toBe("Bearer static-2");
  });

  it("changing the headers prop re-dispatches the thread context exactly once (onHeadersChanged -> triggerRef)", async () => {
    // The provider subscribes to core's `onHeadersChanged` and calls
    // `triggerRef(copilotkit)` so Vue's reactivity actually re-reads
    // `ɵheadersGeneration`-keyed dependents (`headersKey` in use-threads.ts,
    // the HttpAgent watcher in use-agent.ts) when a real source change
    // lands. Without it, nothing pokes Vue: `ɵheadersGeneration` is a plain
    // property read on a non-reactive core instance, not a ref.
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const Threads = defineComponent({
      setup() {
        useThreads({ agentId: "default" });
        return () => null;
      },
    });

    let core!: CopilotKitCoreVue;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: {
        runtimeUrl: "http://rt.test/api/copilotkit",
        headers: {
          Authorization: "Bearer static-1",
        } as CopilotKitHeadersSource,
      },
      slots: { default: () => [h(Threads), h(Probe)] },
    });

    await vi.waitFor(() => expect(core.getAgent("default")).toBeDefined());
    const store = await vi.waitFor(() => {
      const s = core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });
    // Wait for the first (mount) context dispatch before spying, so the spy
    // only observes dispatches caused by the prop change below.
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");

    // A record-to-record change (the case a strict-reference `setSource`
    // dedup can't collapse) — one real source change, one `onHeadersChanged`.
    await wrapper.setProps({
      headers: { Authorization: "Bearer static-2" } as CopilotKitHeadersSource,
    });
    await pollFor(() => setContextSpy.mock.calls.length > 0, 100);

    expect(setContextSpy).toHaveBeenCalledTimes(1);
  });

  it("resolveAgent does not re-run after a builder token rotation + a run + a forced copilotkit trigger", async () => {
    // `resolveAgent`'s watch used to key one of its sources on
    // `JSON.stringify(...headers...)`. A run resolves the builder's CURRENT
    // token and changes that snapshot; the next time ANYTHING pokes Vue's
    // reactivity around `copilotkit` (unrelated to headers), the stale key
    // would differ and (combined with `registeredProxy` forcing the whole
    // watch to skip its diff — see the comment on the watch itself)
    // re-run `resolveAgent`, calling `core.getAgent` and force-triggering
    // `agent` even though nothing about the bound agent itself changed.
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    const Child = defineComponent({
      setup() {
        useAgent({ agentId: "default" });
        return () => null;
      },
    });

    let core!: CopilotKitCoreVue;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    mount(CopilotKitProvider, {
      props: {
        runtimeUrl: "http://rt.test/api/copilotkit",
        headers: (() => ({
          Authorization: `Bearer ${token}`,
        })) as CopilotKitHeadersSource,
      },
      slots: { default: () => [h(Child), h(Probe)] },
    });

    await vi.waitFor(() => expect(core.getAgent("default")).toBeDefined());
    await nextTick();

    token = "tok-2";
    const agent = core.getAgent("default")!;
    await core.runAgent({ agent }).catch(() => {});

    const getAgentSpy = vi.spyOn(core, "getAgent");
    // Force an unrelated Vue-level trigger on `copilotkit` — same technique
    // as the thread-context test above.
    core.setRenderToolCalls([]);
    await pollFor(() => false, 50);

    expect(getAgentSpy).toHaveBeenCalledTimes(0);
  });
});
