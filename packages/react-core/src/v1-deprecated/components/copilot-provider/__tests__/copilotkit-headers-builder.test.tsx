/**
 * #1937: v1's `<CopilotKit>` compatibility wrapper spreads `props.headers`
 * straight into the v2 `<CopilotKitProvider>` (see `copilotkit.tsx`), so the
 * send-time evaluation fix applies to v1 usage automatically — a run must
 * carry the builder's current token even when only a child re-rendered.
 *
 * `<CopilotKit>` is ALSO the main `@copilotkit/react-core/v2` export
 * (`v2/index.ts` re-exports this exact wrapper), so its `headers` prop
 * accepts the full `CopilotKitHeadersSource` (record, sync builder, or
 * async builder — see `copilotkit-props.tsx`), just like the v2 provider.
 *
 * The one exception is the legacy `CopilotTask` / GraphQL path
 * (`lib/copilot-task.ts`), which reads `copilotApiConfig.headers` directly
 * and has no send-time hook to await a builder on. An async builder is
 * never called during render, and never called more than once by that path
 * to discover it is async — see `copilotkit.tsx`'s `copilotApiConfig`
 * `headers` getter.
 */
import { act, render, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../../../v2";
import type { CopilotKitCoreReact } from "../../../../v2/lib/react-core";
import { useCopilotContext } from "../../../context/copilot-context";
import { CopilotKit } from "../copilotkit";

type Call = { url: string; auth: string | null };

function stubFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const h = new Headers(init?.headers ?? (input as Request).headers);
    calls.push({ url, auth: h.get("authorization") });
    if (url.endsWith("/info")) {
      return new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: { default: { name: "default", description: "" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // A non-2xx here would read as a runtime health signal and trigger a
    // reachability re-probe (`handleRuntimeRequestOutcome` in
    // agent-registry.ts) — keep every run request a plain 200 so it can't
    // leak an extra `/info` call.
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

describe("v1 <CopilotKit> — headers builder evaluated at send time (#1937)", () => {
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
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={() => ({ Authorization: `Bearer ${token}` })}
        >
          <Child />
        </CopilotKit>
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

  it("an async builder's current token reaches a run, and rotates on the next run", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;

    function Probe() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      return null;
    }

    function App() {
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={async () => ({ Authorization: `Bearer ${token}` })}
        >
          <Probe />
        </CopilotKit>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());
    const agent = core.getAgent("default")!;

    const callsBeforeFirstRun = calls.length;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });
    const firstRunCalls = calls.slice(callsBeforeFirstRun);
    expect(firstRunCalls.length).toBeGreaterThan(0);
    expect(firstRunCalls.every((c) => c.auth === "Bearer tok-1")).toBe(true);

    token = "tok-2";
    const callsBeforeSecondRun = calls.length;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });
    const secondRunCalls = calls.slice(callsBeforeSecondRun);
    expect(secondRunCalls.length).toBeGreaterThan(0);
    expect(secondRunCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it("an async headers builder is not called during render: 10 re-renders with no requests leave its call count unchanged", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let builderCalls = 0;
    let bumpApp!: () => void;

    function Probe() {
      return null;
    }

    function App() {
      const [n, setN] = useState(0);
      bumpApp = () => setN((prev) => prev + 1);
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          // A fresh `properties` object on every render forces
          // `copilotApiConfig`'s memo to actually recompute each time (it
          // is one of that memo's own dependencies), so this test still
          // discriminates an implementation that (re-)evaluates the
          // builder as part of computing the memo, even one that no
          // longer keys that memo on `headers` itself.
          properties={{ n }}
          // Inline builder: a fresh function identity on every App render.
          headers={async () => {
            builderCalls++;
            return { Authorization: `Bearer ${token}` };
          }}
        >
          <Probe />
        </CopilotKit>
      );
    }

    render(<App />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const callsAfterMount = builderCalls;
    const requestsAfterMount = calls.length;

    for (let i = 0; i < 10; i++) {
      act(() => bumpApp());
    }
    // Let any pending microtask a regression might have queued settle.
    await act(async () => {
      await Promise.resolve();
    });

    // Discriminating assertion FIRST: a re-render alone must never invoke
    // the builder again (React's render phase is not a send-time hook).
    expect(builderCalls).toBe(callsAfterMount);
    // No new requests either — nothing had a reason to fire one.
    expect(calls.length).toBe(requestsAfterMount);
  });

  it("the v1-internal copilotApiConfig.headers getter never receives a Promise from an async builder, and warns once", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let builderCalls = 0;
    let readHeaders!: () => Record<string, string>;
    let useSecondBuilder!: () => void;

    function Reader() {
      const context = useCopilotContext();
      readHeaders = () => context.copilotApiConfig.headers;
      return null;
    }

    function App() {
      const [generation, setGeneration] = useState(0);
      useSecondBuilder = () => setGeneration((g) => g + 1);
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          // A NEW async builder reference each generation — the "warn once"
          // contract is per PROVIDER INSTANCE, not per builder reference, so
          // swapping builders must not re-arm the warning.
          headers={async () => {
            builderCalls++;
            return { Authorization: `Bearer ${token}-gen${generation}` };
          }}
        >
          <Reader />
        </CopilotKit>
      );
    }

    try {
      render(<App />);
      // Let the v2 path's own /info probe settle first, so its (separate)
      // call to the same builder reference is out of the way.
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      const callsBeforeReads = builderCalls;

      const first = readHeaders();
      const second = readHeaders();
      const third = readHeaders();

      // Never a Promise, and never the builder's (unawaited) resolved value.
      // (`hasOwnProperty(first, "then")` would be vacuous here — a real
      // Promise's `.then` lives on `Promise.prototype`, not as an own
      // property of the instance, so that check is always `false` whether
      // or not `first` actually is a Promise.)
      expect(first).not.toBeInstanceOf(Promise);
      expect(first).toEqual({});
      expect(second).toEqual({});
      expect(third).toEqual({});

      // Exactly one v1-internal call total, no matter how many times a
      // consumer reads `.headers` — the first call both discovers the
      // builder is async AND is the only invocation it ever gets.
      expect(builderCalls).toBe(callsBeforeReads + 1);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(
        "An async `headers` builder is not supported by the v1 CopilotTask / GraphQL path",
      );

      // A second, DIFFERENT async builder reference (new generation) is its
      // own fresh detection — it gets called once too — but the dev warning
      // itself must not fire again for this same provider instance.
      act(() => useSecondBuilder());
      readHeaders();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a rejecting async headers builder triggers no unhandled promise rejection", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    let readHeaders!: () => Record<string, string>;

    function Reader() {
      const context = useCopilotContext();
      readHeaders = () => context.copilotApiConfig.headers;
      return null;
    }

    function App() {
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={async () => {
            throw new Error("boom (headers builder rejection)");
          }}
        >
          <Reader />
        </CopilotKit>
      );
    }

    try {
      render(<App />);
      // Let the v2 path's own mount-time header resolution (which handles
      // this same rejection through its own, already-covered
      // `CopilotKitHeaderResolutionError` path) run and settle first.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // The v1-internal getter's OWN call to the same (rejecting) builder:
      // the discarded promise that must not surface as unhandled.
      readHeaders();

      // Discriminating assertion FIRST: Node's `unhandledRejection` check
      // runs on a later tick, after promises have had a chance to attach a
      // handler — give it a couple of ticks before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      warnSpy.mockRestore();
    }
  });

  it("a sync builder still works for both the v2 run path and the v1-internal copilotApiConfig.headers getter", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubFetch(calls));
    let core!: CopilotKitCoreReact;
    let readHeaders!: () => Record<string, string>;

    function Probe() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;
      const context = useCopilotContext();
      readHeaders = () => context.copilotApiConfig.headers;
      return null;
    }

    function App() {
      return (
        <CopilotKit
          runtimeUrl="http://rt.test/api/copilotkit"
          headers={() => ({ Authorization: `Bearer ${token}` })}
        >
          <Probe />
        </CopilotKit>
      );
    }

    render(<App />);
    await waitFor(() => expect(core.getAgent("default")).toBeDefined());

    expect(readHeaders()).toEqual({ Authorization: "Bearer tok-1" });

    token = "tok-2";
    expect(readHeaders()).toEqual({ Authorization: "Bearer tok-2" });

    const agent = core.getAgent("default")!;
    const callsBeforeRun = calls.length;
    await act(async () => {
      await core.runAgent({ agent }).catch(() => {});
    });
    const runCalls = calls.slice(callsBeforeRun);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });
});

function _typeTestAsyncHeadersAccepted() {
  // Widened to `CopilotKitHeadersSource` (#1937 fix X2): an async builder
  // now type-checks here, since `<CopilotKit>` is also the main
  // `@copilotkit/react-core/v2` export.
  return (
    <CopilotKit runtimeUrl="/x" headers={async () => ({})}>
      {null}
    </CopilotKit>
  );
}

function _typeTestNonFunctionNonRecordHeadersRejected() {
  return (
    // @ts-expect-error headers must be a record or a (sync|async) builder
    <CopilotKit runtimeUrl="/x" headers={42}>
      {null}
    </CopilotKit>
  );
}
