/**
 * #1937: the headers builder is evaluated when a request is SENT, not during
 * render. A provider that never re-renders (only a child does, e.g. after a
 * Clerk token refresh) must still send the current token. See
 * `implementer-rules.md` and `task-5-brief.md` for the contract this guards.
 */
import { act, render, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useThreads } from "../../hooks/use-threads";
import type { CopilotKitCoreReact } from "../../lib/react-core";

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

  it.each(["static", "sync", "async"] as const)(
    "StrictMode × %s releases /info and connect",
    async (variant) => {
      const calls: Call[] = [];
      vi.stubGlobal("fetch", stubFetch(calls));

      const headers =
        variant === "static"
          ? { Authorization: "Bearer static" }
          : variant === "sync"
            ? () => ({ Authorization: `Bearer ${token}` })
            : async () => ({ Authorization: `Bearer ${token}` });

      function App() {
        return (
          <CopilotKitProvider
            runtimeUrl="http://rt.test/api/copilotkit"
            headers={headers}
          >
            <div />
          </CopilotKitProvider>
        );
      }

      render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );

      await waitFor(() =>
        expect(calls.filter((c) => c.url.endsWith("/info")).length).toBe(1),
      );

      // Give any StrictMode double-invoked effect a chance to fire a second
      // request before asserting it never arrives.
      await pollFor(() => false, 30);
      expect(calls.filter((c) => c.url.endsWith("/info")).length).toBe(1);
    },
  );

  it("inline builder across 20 rerenders: 0 setHeaders, 0 extra connects", async () => {
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
  });

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

    await pollFor(() => false, 50);

    expect(setContextSpy).toHaveBeenCalledTimes(0);
  });
});
