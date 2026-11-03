/**
 * #1937: the headers builder is evaluated when a request is SENT, not during
 * render. A provider that never re-renders (only a child does, e.g. after a
 * Clerk token refresh) must still send the current token.
 */
import { act, render, waitFor } from "@testing-library/react";
import React, { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import type { CopilotKitHeadersSource } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useThreads } from "../../hooks/use-threads";
import { CopilotKitCoreReact } from "../../lib/react-core";

type Call = { url: string; auth: string | null; publicApiKey: string | null };

function stubFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const h = new Headers(init?.headers ?? (input as Request).headers);
    calls.push({
      url,
      auth: h.get("authorization"),
      publicApiKey: h.get("x-copilotcloud-public-api-key"),
    });
    let body: unknown = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {}
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
    // A non-2xx here would read as a runtime health signal: core treats a
    // failed request while Connected as a cue to re-probe `/info` (see
    // `handleRuntimeRequestOutcome` in agent-registry.ts), which would leak
    // an extra `/info` call into whichever test is running when the probe's
    // fetch actually lands. The run body itself is irrelevant to every
    // assertion here (only the request headers are inspected), so keep every
    // run request a plain 200.
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

/** Poll a predicate inside `act()` instead of sleeping a fixed timeout. */
async function pollFor(predicate: () => boolean, ms = 50): Promise<void> {
  const start = Date.now();
  await act(async () => {
    while (Date.now() - start < ms) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

describe("CopilotKitProvider — headers builder evaluated at send time (#1937)", () => {
  it("a run carries the builder's current token when only a child re-rendered", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let bumpChild!: () => void;

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      const [, set] = useState(0);
      bumpChild = () => set((n) => n + 1);
      return null;
    }

    function App() {
      return (
        <CopilotKitProvider
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={() => ({ Authorization: `Bearer ${token}` })}
        >
          <Child />
        </CopilotKitProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());
    const callsBeforeRun = calls.length;

    // Token rotates (e.g. Clerk re-mint). Only the child re-renders.
    token = "tok-2";
    act(() => bumpChild());

    const agent = core.getAgent("default")!;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it("an async builder is awaited", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let bumpChild!: () => void;

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      const [, set] = useState(0);
      bumpChild = () => set((n) => n + 1);
      return null;
    }

    function App() {
      return (
        <CopilotKitProvider
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { Authorization: `Bearer ${token}` };
          }}
        >
          <Child />
        </CopilotKitProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());
    const callsBeforeRun = calls.length;

    token = "tok-2";
    act(() => bumpChild());

    const agent = core.getAgent("default")!;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });

    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it.each([
    {
      label: "static",
      headers: { Authorization: "Bearer static" } as CopilotKitHeadersSource,
      publicApiKey: undefined,
      expectedAuth: "Bearer static",
    },
    {
      label: "sync",
      headers: (() => ({
        Authorization: `Bearer ${token}`,
      })) as CopilotKitHeadersSource,
      publicApiKey: undefined,
      expectedAuth: "Bearer tok-1",
    },
    {
      label: "async",
      headers: (async () => ({
        Authorization: `Bearer ${token}`,
      })) as CopilotKitHeadersSource,
      publicApiKey: undefined,
      expectedAuth: "Bearer tok-1",
    },
    {
      label: "inline builder + publicApiKey",
      headers: (() => ({
        Authorization: `Bearer ${token}`,
      })) as CopilotKitHeadersSource,
      publicApiKey: "pk_test_123",
      expectedAuth: "Bearer tok-1",
    },
  ])(
    "StrictMode × $label releases /info and connect",
    async ({ headers, publicApiKey, expectedAuth }) => {
      const calls: Call[] = [];
      vi.stubGlobal("fetch", stubFetch(calls));
      // Proves the mount effect actually double-invoked (StrictMode), rather
      // than merely asserting an absence that could pass for unrelated
      // reasons (e.g. StrictMode not wrapping anything).
      const connectSpy = vi.spyOn(CopilotKitCoreReact.prototype, "connect");
      let core!: CopilotKitCoreReact;

      function Probe() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit;
        return null;
      }

      function App() {
        return (
          <CopilotKitProvider
            runtimeUrl="http://rt.test/api/copilotkit"
            publicApiKey={publicApiKey}
            headers={headers}
          >
            <Probe />
          </CopilotKitProvider>
        );
      }

      render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );

      await waitFor(() =>
        expect(core.runtimeConnectionStatus).toBe(
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        ),
      );
      await waitFor(() =>
        expect(calls.filter((c) => c.url.endsWith("/info")).length).toBe(1),
      );

      const infoCall = calls.find((c) => c.url.endsWith("/info"));
      expect(infoCall?.auth).toBe(expectedAuth);
      if (publicApiKey) {
        expect(infoCall?.publicApiKey).toBe(publicApiKey);
      }

      // StrictMode double-invokes the mount effect exactly once; `connect()`
      // is idempotent, so this must NOT double the `/info` request above.
      expect(connectSpy).toHaveBeenCalledTimes(2);

      // Give any (buggy) extra effect invocation a real chance to fire a
      // second request before asserting it never arrives.
      await pollFor(() => false, 50);
      expect(calls.filter((c) => c.url.endsWith("/info")).length).toBe(1);

      connectSpy.mockRestore();
    },
  );

  it.each([
    { label: "no publicApiKey", publicApiKey: undefined },
    // With a publicApiKey, `ɵwithHeaderDefaults` is no longer a passthrough:
    // it wraps the builder in a NEW closure on every call (non-empty
    // defaults), so this row is the one that actually exercises the memo's
    // dependency array — the plain-builder row above still passes even if
    // the deps are wrong, because `ɵwithHeaderDefaults` returns the source
    // unchanged when there are no defaults to fill.
    { label: "with publicApiKey (Cloud)", publicApiKey: "pk_test_123" },
  ])(
    "inline builder across 20 rerenders: 0 setHeaders, 0 extra connects ($label)",
    async ({ publicApiKey }) => {
      const calls: Call[] = [];
      vi.stubGlobal("fetch", stubFetch(calls));
      let core!: CopilotKitCoreReact;
      let bumpApp!: () => void;

      function Probe() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit;
        return null;
      }

      function App() {
        const [, setN] = useState(0);
        bumpApp = () => setN((n) => n + 1);
        return (
          <CopilotKitProvider
            runtimeUrl="http://rt.test/api/copilotkit"
            publicApiKey={publicApiKey}
            // Inline builder: a fresh function identity on every App render.
            headers={() => ({ Authorization: `Bearer ${token}` })}
          >
            <Probe />
          </CopilotKitProvider>
        );
      }

      render(<App />);
      await waitFor(() => expect(core.getAgent("default")).toBeDefined());

      const setHeadersSpy = vi.spyOn(core, "setHeaders");
      const connectSpy = vi.spyOn(core, "connect");

      for (let i = 0; i < 20; i++) {
        act(() => bumpApp());
      }

      await pollFor(() => false, 50);

      expect(setHeadersSpy).toHaveBeenCalledTimes(0);
      expect(connectSpy).toHaveBeenCalledTimes(0);
    },
  );

  it("the public API key header is added when headers omit it", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));

    render(
      <CopilotKitProvider
        runtimeUrl="http://rt.test/api/copilotkit"
        publicApiKey="pk_test_123"
        headers={() => ({})}
      >
        <div />
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      const infoCall = calls.find((c) => c.url.endsWith("/info"));
      expect(infoCall).toBeDefined();
      expect(infoCall?.publicApiKey).toBe("pk_test_123");
    });
  });

  it("a token change at re-render does not re-dispatch the thread context", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let bumpChild!: () => void;

    function Threads() {
      useThreads({ agentId: "default" });
      return null;
    }

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      const [, set] = useState(0);
      bumpChild = () => set((n) => n + 1);
      return (
        <>
          <Threads />
        </>
      );
    }

    function App() {
      return (
        <CopilotKitProvider
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={() => ({ Authorization: `Bearer ${token}` })}
        >
          <Child />
        </CopilotKitProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());

    const store = await waitFor(() => {
      const s = core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });

    // Wait for the first (mount) context dispatch before spying, so the spy
    // only observes dispatches caused by the token rotation below.
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");

    token = "tok-2";
    act(() => bumpChild());

    // Send a request so the builder runs and the resolved headers change,
    // then re-render so `useThreads` reads them. Without both, nothing reads
    // the new token and the assertion below passes no matter what
    // `useThreads` keys on.
    const callsBeforeRun = calls.length;
    const agent = core.getAgent("default")!;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });
    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
    act(() => bumpChild());

    await pollFor(() => false, 50);

    expect(setContextSpy).toHaveBeenCalledTimes(0);
  });

  it("a static headers record + a changing properties prop gives 0 extra thread-context dispatches", async () => {
    // #1937 regression: the provider's config effect (properties, credentials,
    // agents, debug) calls `copilotkit.setHeaders(headersSource)` on every
    // re-run, including when only `properties` changed. For a RECORD source
    // that must be a no-op when the values are unchanged, or an unrelated
    // prop change bumps `ɵheadersGeneration`, fires `onHeadersChanged`, and
    // (via `useCopilotKit`'s forceUpdate) re-dispatches every thread store's
    // context, refetching threads for no reason.
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let bumpProperties!: () => void;

    function Threads() {
      useThreads({ agentId: "default" });
      return null;
    }

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      return <Threads />;
    }

    function App() {
      const [n, setN] = useState(0);
      bumpProperties = () => setN((x) => x + 1);
      return (
        <CopilotKitProvider
          runtimeUrl="http://rt.test/api/copilotkit"
          // A fresh object literal on every App render — a caller who
          // doesn't memoize `headers` — but the same VALUES every time.
          headers={{ Authorization: "Bearer static" }}
          properties={{ n }}
        >
          <Child />
        </CopilotKitProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());

    const store = await waitFor(() => {
      const s = core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });

    // Wait for the mount dispatch before spying, so the spy only observes
    // dispatches caused by the property bump below.
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");
    const gen = core.ɵheadersGeneration;

    for (let i = 0; i < 5; i++) {
      act(() => bumpProperties());
    }

    await pollFor(() => false, 50);

    expect(core.ɵheadersGeneration).toBe(gen);
    expect(setContextSpy).toHaveBeenCalledTimes(0);
  });

  it("changing the headers record's VALUE gives exactly 1 extra thread-context dispatch", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let setAuth!: (v: string) => void;

    function Threads() {
      useThreads({ agentId: "default" });
      return null;
    }

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      return <Threads />;
    }

    function App() {
      const [auth, setAuthState] = useState("a1");
      setAuth = setAuthState;
      return (
        <CopilotKitProvider
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={{ Authorization: `Bearer ${auth}` }}
        >
          <Child />
        </CopilotKitProvider>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());

    const store = await waitFor(() => {
      const s = core.getThreadStore("default");
      expect(s).toBeDefined();
      return s!;
    });

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true);
    });

    const setContextSpy = vi.spyOn(store, "setContext");

    act(() => setAuth("a2"));

    await waitFor(() => expect(setContextSpy).toHaveBeenCalledTimes(1));
  });

  it("a child effect firing in the same commit as a token bump reads the new token, not the previous commit's closure", async () => {
    // `headersRef.current` is assigned
    // during render, not in a passive `useEffect`. React fires a CHILD's
    // effects before the PARENT's own effects (bottom-up), so if the
    // provider only updated the ref from its own effect, a child effect that
    // runs a request in the SAME commit as a new builder closure would still
    // read the previous commit's stale closure.
    //
    // A plain (non-proxied) `HttpAgent` is used deliberately: it is never
    // wrapped with `ɵruntimeFetch`, so `prepareAgentHeadersForRun`'s ONE
    // synchronous resolution (which happens for a sync builder entirely
    // within the same JS turn as `runAgent()` is called, before any await)
    // is the only place the current token can land on `agent.headers`. A
    // proxied runtime agent would be re-resolved a second time by
    // `ɵruntimeFetch` at actual send time, which would mask this exact race.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 200 })),
    );
    const agent = new HttpAgent({ url: "http://direct.test/agent" });
    let setAppToken!: (t: string) => void;

    function Child({ appToken }: { appToken: string }) {
      const { copilotkit } = useCopilotKit();
      useEffect(() => {
        void copilotkit.runAgent({ agent }).catch(() => {});
        // Deliberately keyed on `appToken` so this effect re-fires in the
        // exact same commit as the App-state bump below.
      }, [copilotkit, appToken]);
      return null;
    }

    function App() {
      const [appToken, setAppTok] = useState("tok-1");
      setAppToken = setAppTok;
      return (
        <CopilotKitProvider
          agents__unsafe_dev_only={{ direct: agent }}
          headers={() => ({ Authorization: `Bearer ${appToken}` })}
        >
          <Child appToken={appToken} />
        </CopilotKitProvider>
      );
    }

    render(<App />);
    await waitFor(() =>
      expect(agent.headers.Authorization).toBe("Bearer tok-1"),
    );

    act(() => setAppToken("tok-2"));

    // Synchronous: `prepareAgentHeadersForRun` resolves a sync builder and
    // writes `agent.headers` entirely within `act()`'s flush, no awaiting
    // needed.
    expect(agent.headers.Authorization).toBe("Bearer tok-2");
  });
});
