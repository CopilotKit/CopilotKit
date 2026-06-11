import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { z } from "zod";
import type { OpenGenerativeUIContent } from "../OpenGenerativeUIRenderer";
import { OpenGenerativeUIActivityRenderer } from "../OpenGenerativeUIRenderer";
import { SandboxFunctionsContext } from "../../providers/SandboxFunctionsContext";
import {
  OpenGenerativeUIOptionsProvider,
  DEFAULT_OPEN_GEN_UI_OPTIONS,
} from "../../providers/OpenGenerativeUIOptionsContext";
import { assembleDocument } from "../../lib/assembleDocument";
import type { SandboxFunction } from "../../types/sandbox-function";

// The renderer's outer wrapper throttles non-immediate content changes with
// setTimeout(THROTTLE_MS). Keep this in lockstep with THROTTLE_MS in the source.
const THROTTLE_MS = 1000;

// Mock @jetbrains/websandbox
const mockRun = vi.fn().mockResolvedValue(undefined);
const mockDestroy = vi.fn();
let mockIframe: HTMLIFrameElement;
let mockPromiseResolve: () => void;
let mockPromise: Promise<unknown>;

function resetMockPromise() {
  mockPromise = new Promise<void>((resolve) => {
    mockPromiseResolve = resolve;
  });
}

/**
 * Handle for one sandbox the mock has handed back to the renderer. The renderer
 * stores this exact object in `sandboxRef.current` (final) or
 * `previewSandboxRef.current` (preview), so its `contentWindow` sentinel is
 * precisely what the height listener's
 * `e.source === sandboxRef.current?.iframe?.contentWindow` guard compares
 * against. Tests read the sentinel from here rather than re-stubbing the
 * module-level `mockIframe` after the fact — that decouples the dispatched
 * MessageEvent source from any timing assumption about which iframe the shared
 * `mockIframe` variable currently points at.
 */
interface CreatedSandbox {
  iframe: HTMLIFrameElement;
  /** Stable sentinel installed as iframe.contentWindow at creation time. */
  contentWindow: Window;
  run: typeof mockRun;
  destroy: typeof mockDestroy;
  promise: Promise<unknown>;
}

/**
 * Every sandbox the mock has created, in creation order. `createdSandboxes.at(-1)`
 * is the object the renderer most recently assigned to its sandbox ref, so the
 * tests can address "the current sandbox" by identity instead of inferring it
 * from microtask timing. Reset in beforeEach.
 */
let createdSandboxes: CreatedSandbox[] = [];

const mockCreate = vi.fn(() => {
  mockIframe = document.createElement("iframe");
  // Install a stable, known contentWindow sentinel at creation time. A detached
  // iframe's contentWindow is null in jsdom, so without this the height
  // listener's source guard could never match; pinning it here (and recording it
  // on the handle) makes the listener-visible source deterministic and lets
  // tests dispatch the exact window object the guard will compare against.
  const contentWindow = {} as Window;
  Object.defineProperty(mockIframe, "contentWindow", {
    configurable: true,
    value: contentWindow,
  });
  const sandbox: CreatedSandbox = {
    iframe: mockIframe,
    contentWindow,
    run: mockRun,
    destroy: mockDestroy,
    promise: mockPromise,
  };
  createdSandboxes.push(sandbox);
  return sandbox;
});

vi.mock("@jetbrains/websandbox", () => ({
  default: {
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

// How many microtask hops to flush inside a single `act` to drain the renderer's
// sandbox-build chain. The chain is a fixed, short sequence of microtask hops:
// the dynamic `import("@jetbrains/websandbox")` resolves -> its `.then` runs
// `Websandbox.create` (so `mockCreate` fires) and registers the
// `sandbox.promise.then` callback -> on resolve, that callback runs and flushes
// the pending queue. React's `act` interleaves a bounded number of effect/commit
// hops between them. 100 yields is comfortably deeper than any of those chains
// and — crucially — performs the SAME work on every run regardless of CPU load
// (microtasks run to completion between awaits; contention delays wall-clock, not
// ordering). That makes the drain deterministic, not margin-based.
const MICROTASK_FLUSH_COUNT = 100;

/**
 * Flush the renderer's sandbox-build microtask chain deterministically.
 *
 * The previous implementation broke when `mockCreate`'s call count went "quiet"
 * for one iteration — a heuristic proxy for "settled" with a hard cap. Under CPU
 * contention that proxy could read quiet in the one-tick gap *before* the host's
 * `sandbox.promise.then` callback had armed `sandboxRef`-visible state, so the
 * subsequent height MessageEvent was rejected (the documented `re-measures …`
 * flake). This version drops the heuristic: it flushes a fixed number of
 * microtask hops, which fully drains the (short, fixed-depth) chain and does
 * identical work on every run. It uses NO real timer, so it stays safe under
 * `vi.useFakeTimers()` (a `setTimeout(0)` would otherwise hang there).
 *
 * For assertions that depend on a *specific* downstream signal (a rebuilt
 * sandbox having been created, or its measurement having replayed), prefer
 * {@link flushUntil}, which gates on that concrete condition and fails loud if it
 * never holds.
 */
async function flushImport() {
  await act(async () => {
    for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  });
}

/**
 * Flush microtasks inside `act` until `cond()` holds, then stop. Unlike a
 * fixed-count or call-count-quiet drain, this waits for the EXACT causal signal
 * the next assertion needs — e.g. "the rebuilt sandbox has been created"
 * (`createdSandboxes.length === 2`) or "the rebuilt sandbox's measurement has
 * replayed". If the condition never becomes true within a generous microtask
 * budget it throws, so a genuinely stuck chain fails loudly instead of letting a
 * later assertion fail with a misleading value. No wall-clock, no real timer —
 * safe under fake timers.
 */
async function flushUntil(cond: () => boolean, label = "condition") {
  let settled = false;
  await act(async () => {
    for (let i = 0; i < MICROTASK_FLUSH_COUNT; i++) {
      if (cond()) {
        settled = true;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
    if (cond()) settled = true;
  });
  if (!settled) {
    throw new Error(
      `flushUntil: ${label} never became true within ${MICROTASK_FLUSH_COUNT} microtask flushes`,
    );
  }
}

/** Count of sandbox.run calls carrying the one-shot height measurement script. */
function measureRunCount(): number {
  return mockRun.mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === "string" && (c[0] as string).includes("__ck_resize"),
  ).length;
}

/**
 * Advance the renderer's throttle window deterministically. The outer wrapper
 * schedules `setTimeout(flush, THROTTLE_MS)` for non-immediate content changes;
 * under `vi.useFakeTimers()` we step exactly THROTTLE_MS so `flush` fires (no
 * wall-clock margin a loaded worker can blow through), then drain the microtasks
 * the resulting re-render queues. Requires `vi.useFakeTimers()` to be active.
 */
async function flushThrottle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
  });
  // Drain the import/promise microtask chain the re-render may have kicked off.
  await flushImport();
}

function renderRenderer(content: OpenGenerativeUIContent) {
  return render(
    <OpenGenerativeUIActivityRenderer
      activityType="open-generative-ui"
      content={content}
      message={{}}
      agent={{}}
    />,
  );
}

describe("OpenGenerativeUIActivityRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPromise();
    createdSandboxes = [];
  });

  afterEach(() => {
    cleanup();
    // Defensive: any test that opted into fake timers must not leak that state
    // into a sibling running in the same worker (the parallel-load scenario the
    // flake was reproduced under). A no-op when real timers are already active.
    vi.useRealTimers();
  });

  it("renders placeholder when no html", async () => {
    const { container } = renderRenderer({ initialHeight: 300 });
    await flushImport();

    const div = container.firstElementChild as HTMLElement;
    expect(div.style.height).toBe("300px");
    expect(div.querySelector("svg")).not.toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates sandbox when html is complete", async () => {
    const html = "<head></head><body><p>Hello</p></body>";
    renderRenderer({ html: [html], htmlComplete: true });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    // assembleDocument injects importmap + design system kit into the head before agent html
    expect(options.frameContent).toContain("<body><p>Hello</p></body>");
    expect(options.frameContainer).toBeInstanceOf(HTMLElement);
  });

  it("creates preview sandbox when html is streaming (not complete)", async () => {
    renderRenderer({
      html: ["<head></head><body>partial"],
      htmlComplete: false,
      cssComplete: true,
    });
    await flushImport();

    // Preview sandbox is created with empty body template
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toBe("<head></head><body></body>");
  });

  it("wraps html missing <head>", async () => {
    renderRenderer({
      html: ["<body><p>No head</p></body>"],
      htmlComplete: true,
    });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    // assembleDocument ensures a <head> exists then injects kit into it
    expect(options.frameContent).toContain("<head>");
    expect(options.frameContent).toContain("<body><p>No head</p></body>");
  });

  it("joins html chunks when complete", async () => {
    renderRenderer({
      html: ["<head></head>", "<body>", "<p>Hello</p>", "</body>"],
      htmlComplete: true,
    });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    // assembleDocument injects importmap + design system kit into the head before agent content
    expect(options.frameContent).toContain("<body><p>Hello</p></body>");
    expect(options.frameContent).toContain("<head>");
  });

  it("destroys sandbox on unmount", async () => {
    const { unmount } = renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
    });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("injects jsFunctions via run()", async () => {
    const jsFunctions = "function greet() { return 'hi'; }";
    renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
      jsFunctions,
    });
    await flushImport();

    // Resolve sandbox promise
    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });
    await flushImport();

    expect(mockRun).toHaveBeenCalledWith(jsFunctions);
  });

  it("executes jsExpressions sequentially", async () => {
    renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
      jsExpressions: ["expr1()", "expr2()"],
    });
    await flushImport();

    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });
    await flushImport();

    expect(mockRun).toHaveBeenCalledWith("expr1()");
    expect(mockRun).toHaveBeenCalledWith("expr2()");
  });

  it("tracks index — no re-execution on re-render", async () => {
    const { rerender } = render(
      <OpenGenerativeUIActivityRenderer
        activityType="open-generative-ui"
        content={{
          html: ["<head></head><body></body>"],
          htmlComplete: true,
          jsExpressions: ["expr1()"],
        }}
        message={{}}
        agent={{}}
      />,
    );
    await flushImport();

    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });
    await flushImport();

    const callCountAfterFirst = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === "expr1()",
    ).length;
    expect(callCountAfterFirst).toBe(1);

    // Re-render with additional expression
    rerender(
      <OpenGenerativeUIActivityRenderer
        activityType="open-generative-ui"
        content={{
          html: ["<head></head><body></body>"],
          htmlComplete: true,
          jsExpressions: ["expr1()", "expr2()"],
        }}
        message={{}}
        agent={{}}
      />,
    );
    await flushImport();

    // expr1 should NOT have been called again
    const expr1Calls = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === "expr1()",
    ).length;
    expect(expr1Calls).toBe(1);

    // expr2 should have been called
    const expr2Calls = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === "expr2()",
    ).length;
    expect(expr2Calls).toBe(1);
  });

  it("queues JS before sandbox ready", async () => {
    renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
      jsFunctions: "function foo() {}",
      jsExpressions: ["foo()"],
    });
    await flushImport();

    // Sandbox not ready yet — run should not have been called
    expect(mockRun).not.toHaveBeenCalled();

    // Now resolve
    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });
    await flushImport();

    // Both should have been flushed
    expect(mockRun).toHaveBeenCalledWith("function foo() {}");
    expect(mockRun).toHaveBeenCalledWith("foo()");
  });

  it("re-queues JS into a rebuilt sandbox when html changes (not a JS change)", async () => {
    const jsFunctions = "function foo(){}";
    const { rerender } = render(
      <OpenGenerativeUIActivityRenderer
        activityType="open-generative-ui"
        content={{
          html: ["<head></head><body>v1</body>"],
          htmlComplete: true,
          jsFunctions,
          jsExpressions: ["foo()"],
        }}
        message={{}}
        agent={{}}
      />,
    );
    await flushImport();

    // First sandbox ready — flush its queued JS
    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });
    await flushImport();

    // First sandbox ran jsFunctions + the expression exactly once each
    const fnCallsFirst = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === jsFunctions,
    ).length;
    const exprCallsFirst = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === "foo()",
    ).length;
    expect(fnCallsFirst).toBe(1);
    expect(exprCallsFirst).toBe(1);

    // Rebuild trigger is the HTML, NOT a JS change: jsFunctions/jsExpressions are
    // byte-identical so Effects 2/3 will not re-fire. The rebuilt sandbox must
    // still receive the JS via Effect 1's re-queue.
    mockRun.mockClear();
    resetMockPromise();
    rerender(
      <OpenGenerativeUIActivityRenderer
        activityType="open-generative-ui"
        content={{
          html: ["<head></head><body>v2</body>"],
          htmlComplete: true,
          jsFunctions,
          jsExpressions: ["foo()"],
        }}
        message={{}}
        agent={{}}
      />,
    );
    await flushImport();

    // Old sandbox destroyed, new one created
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // New sandbox not ready yet — nothing flushed
    expect(mockRun).not.toHaveBeenCalledWith(jsFunctions);
    expect(mockRun).not.toHaveBeenCalledWith("foo()");

    // Resolve the second sandbox — the re-queued JS must replay
    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });
    await flushImport();

    // The second sandbox received BOTH the jsFunctions string and the expression
    // again (re-injected), each exactly once — no double-execution.
    const fnCallsSecond = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === jsFunctions,
    ).length;
    const exprCallsSecond = mockRun.mock.calls.filter(
      (c: unknown[]) => c[0] === "foo()",
    ).length;
    expect(fnCallsSecond).toBe(1);
    expect(exprCallsSecond).toBe(1);
  });

  it("recreates sandbox when html changes", async () => {
    const { rerender } = render(
      <OpenGenerativeUIActivityRenderer
        activityType="open-generative-ui"
        content={{ html: ["<head></head><body>v1</body>"], htmlComplete: true }}
        message={{}}
        agent={{}}
      />,
    );
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockPromiseResolve();
      await mockPromise;
    });

    // Change html — need a new promise for the new sandbox
    resetMockPromise();
    rerender(
      <OpenGenerativeUIActivityRenderer
        activityType="open-generative-ui"
        content={{ html: ["<head></head><body>v2</body>"], htmlComplete: true }}
        message={{}}
        agent={{}}
      />,
    );
    await flushImport();

    // Old sandbox destroyed, new one created
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const [, options] = mockCreate.mock.calls[1];
    expect(options.frameContent).toContain("v2");
  });

  describe("sandboxFunctions / localApi", () => {
    function renderWithSandboxFunctions(
      content: OpenGenerativeUIContent,
      sandboxFunctions: SandboxFunction[],
    ) {
      return render(
        <SandboxFunctionsContext.Provider value={sandboxFunctions}>
          <OpenGenerativeUIActivityRenderer
            activityType="open-generative-ui"
            content={content}
            message={{}}
            agent={{}}
          />
        </SandboxFunctionsContext.Provider>,
      );
    }

    it("passes localApi built from sandbox functions to websandbox", async () => {
      const handler = vi.fn().mockResolvedValue(42);
      const fns: SandboxFunction[] = [
        {
          name: "addToCart",
          description: "Add item to cart",
          parameters: z.object({ itemId: z.string() }),
          handler,
        },
      ];

      renderWithSandboxFunctions(
        { html: ["<head></head><body>test</body>"], htmlComplete: true },
        fns,
      );
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [localApi] = mockCreate.mock.calls[0];
      expect(localApi).toHaveProperty("addToCart");
      expect(localApi.addToCart).toBe(handler);
    });

    it("passes empty localApi when no sandbox functions", async () => {
      renderWithSandboxFunctions(
        { html: ["<head></head><body>test</body>"], htmlComplete: true },
        [],
      );
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [localApi] = mockCreate.mock.calls[0];
      expect(Object.keys(localApi)).toHaveLength(0);
    });

    it("recreates sandbox when sandbox functions change", async () => {
      const handler1 = vi.fn();
      const fns1: SandboxFunction[] = [
        {
          name: "fn1",
          description: "first",
          parameters: z.object({}),
          handler: handler1,
        },
      ];

      const { rerender } = render(
        <SandboxFunctionsContext.Provider value={fns1}>
          <OpenGenerativeUIActivityRenderer
            activityType="open-generative-ui"
            content={{
              html: ["<head></head><body>test</body>"],
              htmlComplete: true,
            }}
            message={{}}
            agent={{}}
          />
        </SandboxFunctionsContext.Provider>,
      );
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });

      // Change sandbox functions
      const handler2 = vi.fn();
      const fns2: SandboxFunction[] = [
        {
          name: "fn2",
          description: "second",
          parameters: z.object({}),
          handler: handler2,
        },
      ];

      resetMockPromise();
      rerender(
        <SandboxFunctionsContext.Provider value={fns2}>
          <OpenGenerativeUIActivityRenderer
            activityType="open-generative-ui"
            content={{
              html: ["<head></head><body>test</body>"],
              htmlComplete: true,
            }}
            message={{}}
            agent={{}}
          />
        </SandboxFunctionsContext.Provider>,
      );
      await flushImport();

      // Old sandbox destroyed, new one created with new localApi
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      const [localApi] = mockCreate.mock.calls[1];
      expect(localApi).toHaveProperty("fn2");
      expect(localApi.fn2).toBe(handler2);
    });

    it("includes multiple sandbox functions in localApi", async () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const fns: SandboxFunction[] = [
        {
          name: "fnA",
          description: "A",
          parameters: z.object({}),
          handler: handlerA,
        },
        {
          name: "fnB",
          description: "B",
          parameters: z.object({}),
          handler: handlerB,
        },
      ];

      renderWithSandboxFunctions(
        { html: ["<head></head><body>test</body>"], htmlComplete: true },
        fns,
      );
      await flushImport();

      const [localApi] = mockCreate.mock.calls[0];
      expect(Object.keys(localApi)).toHaveLength(2);
      expect(localApi.fnA).toBe(handlerA);
      expect(localApi.fnB).toBe(handlerB);
    });
  });

  describe("progressive streaming preview", () => {
    it("creates preview sandbox when chunks arrive but htmlComplete is false", async () => {
      renderRenderer({
        html: ["<body><div>Hello</div>"],
        htmlComplete: false,
        cssComplete: true,
        generating: true,
      });
      await flushImport();

      // Preview sandbox created with empty body template
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [localApi, options] = mockCreate.mock.calls[0];
      expect(options.frameContent).toBe("<head></head><body></body>");
      expect(Object.keys(localApi)).toHaveLength(0);
    });

    it("updates preview on re-render with more chunks (after throttle)", async () => {
      // Deterministic throttle: step exactly THROTTLE_MS with fake timers
      // instead of racing a real 1100ms wall-clock wait against the renderer's
      // 1000ms throttle (the ~100ms margin a loaded worker could blow through).
      vi.useFakeTimers();
      const { rerender } = render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>Hello</div>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Resolve preview sandbox promise
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // Should have called run with innerHTML update (initial content — immediate flush)
      const innerHtmlCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(innerHtmlCalls.length).toBeGreaterThanOrEqual(1);

      // Re-render with more chunks — throttled by the outer wrapper
      mockRun.mockClear();
      rerender(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>Hello</div>", "<p>World</p>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );

      // Advance exactly the throttle window so the deferred flush fires.
      await flushThrottle();

      // Should have updated innerHTML with new content after throttle
      const updateCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      expect(updateCalls[updateCalls.length - 1]![0]).toContain("World");
    }, 10000);

    it("applies the latest streamed content when the preview sandbox becomes ready (no stale snapshot)", async () => {
      // The preview sandbox is created asynchronously: Effect 0 starts the
      // dynamic import() and the sandbox's ready promise resolves a tick later.
      // If newer chunks stream in DURING that window, Effect 0b cannot apply them
      // (it early-returns until previewReadyRef flips true), so the snapshot that
      // Effect 0's resolve callback applies must be read live — otherwise the
      // preview shows the creation-time frame until the next content change, and
      // if the stream already ended there is no next change.
      //
      // RED pre-fix: Effect 0's promise.then closed over previewBody/previewStyles
      // captured when the effect ran, so the FIRST applied frame was "OLD" only.
      // GREEN post-fix: it reads the latest frame via a ref, so "NEW" is applied.
      //
      // Deterministic throttle (fake timers) so the newer chunk is guaranteed to
      // have been applied to the inner component before the sandbox resolves —
      // not racing a real wall-clock wait against the 1000ms throttle.
      vi.useFakeTimers();
      const { rerender } = render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>OLD</div>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );

      // Resolve the dynamic import() so Websandbox.create runs and the preview
      // sandbox ref is populated — but DO NOT resolve the sandbox ready promise.
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // A newer chunk streams in before the sandbox is ready. Going 1->2 chunks
      // (htmlComplete:false) is throttled by the outer wrapper, so step the
      // throttle window to let the inner component re-render with the newer body.
      // Effect 0 does not re-fire (the sandbox ref is set); Effect 0b fires but
      // early-returns because previewReadyRef is still false.
      rerender(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>OLD</div>", "<div>NEW</div>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushThrottle();

      // Now the sandbox becomes ready. Its resolve callback applies the preview
      // frame — which must be the latest one, not the creation-time snapshot.
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      const bodyCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(bodyCalls.length).toBeGreaterThanOrEqual(1);
      // The body the sandbox first received must already include the newer chunk.
      const firstBody = bodyCalls[0]![0] as string;
      expect(firstBody).toContain("NEW");
    }, 10000);

    it("destroys preview and creates final sandbox when htmlComplete arrives", async () => {
      const { rerender } = render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>Hello</div>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Now complete the HTML
      resetMockPromise();
      rerender(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: [
              "<head><style>body{margin:0}</style></head><body><div>Hello</div></body>",
            ],
            htmlComplete: true,
            cssComplete: true,
            generating: false,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview destroyed, final sandbox created
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);

      const [, options] = mockCreate.mock.calls[1];
      expect(options.frameContent).toContain("<style>");
      expect(options.frameContent).toContain("Hello");
    });

    it("destroys the preview sandbox when the body empties mid-stream, then rebuilds it for a later chunk", async () => {
      // Mirrors the Vue renderer's watch([hasPreview, fullHtml]) -> destroyPreview()
      // teardown. While still streaming (htmlComplete:false, no fullHtml), the
      // accumulated HTML can transiently reduce to an empty body region — e.g. the
      // only complete markup so far is a <head> element, which processPartialHtml
      // strips, leaving previewBody empty. hasPreview then flips false and the
      // container reverts to placeholder styling. The orphaned preview iframe must
      // be torn down (not left mounted behind the spinner), and a later non-empty
      // chunk must create a FRESH preview.
      //
      // RED pre-fix: only Effect 1 (fullHtml truthy) and unmount destroy the
      // preview sandbox, so an empty mid-stream body leaves it mounted —
      // mockDestroy is never called and no second sandbox is created.
      //
      // Fake timers so the two throttled re-renders below step the throttle
      // window deterministically instead of racing a real wall-clock wait.
      vi.useFakeTimers();
      const { rerender } = render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>Hello</div>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox created and painted.
      expect(mockCreate).toHaveBeenCalledTimes(1);
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // A chunk arrives whose only complete markup is a <head> element;
      // processPartialHtml strips it, so previewBody is empty and hasPreview
      // flips false. This is a throttled change (htmlComplete stays false, no
      // immediate-flush trigger), so step the throttle window.
      rerender(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<head><style>.x{color:red}</style></head>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushThrottle();

      // The orphaned preview sandbox must be destroyed and the container emptied.
      expect(mockDestroy).toHaveBeenCalledTimes(1);

      // A later non-empty chunk must build a FRESH preview sandbox (the ref was
      // reset, so Effect 0 re-creates). New promise for the new sandbox.
      mockRun.mockClear();
      resetMockPromise();
      rerender(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>World</div>"],
            htmlComplete: false,
            cssComplete: true,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushThrottle();

      // Second preview sandbox created.
      expect(mockCreate).toHaveBeenCalledTimes(2);
      const [, options] = mockCreate.mock.calls[1];
      expect(options.frameContent).toBe("<head></head><body></body>");

      // Resolve the rebuilt preview and assert the new body is painted.
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      const bodyCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(bodyCalls.length).toBeGreaterThanOrEqual(1);
      expect(bodyCalls[bodyCalls.length - 1]![0]).toContain("World");
    }, 10000);

    it("does not show preview until cssComplete, then starts streaming HTML immediately", async () => {
      // Phase 1: HTML chunks arrive but CSS is not yet complete — no preview
      const { rerender } = render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            html: ["<body><div>Streaming content</div>"],
            htmlComplete: false,
            generating: true,
            // cssComplete is NOT set — CSS still generating
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // No sandbox created — placeholder shown while CSS is pending
      expect(mockCreate).not.toHaveBeenCalled();

      // Phase 2: CSS completes — preview should appear immediately with the
      // HTML chunks that have already accumulated
      rerender(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            css: "body { margin: 0; color: red; }",
            cssComplete: true,
            html: ["<body><div>Streaming content</div>"],
            htmlComplete: false,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox created now that CSS is complete
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      expect(options.frameContent).toBe("<head></head><body></body>");

      // Resolve sandbox promise so preview content is applied
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // CSS should be injected into <head> as a <style> tag
      const headCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      expect(headCalls.length).toBeGreaterThanOrEqual(1);
      expect(headCalls[0][0]).toContain("body { margin: 0; color: red; }");

      // HTML body content should be rendered in the preview
      const bodyCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(bodyCalls.length).toBeGreaterThanOrEqual(1);
      expect(bodyCalls[0][0]).toContain("Streaming content");
    });

    it("does not create preview when no meaningful body content", async () => {
      renderRenderer({
        html: ["<head><style>.foo { color: red; }</style></head>"],
        htmlComplete: false,
        generating: true,
      });
      await flushImport();

      // No preview — only head content, no body
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("skips preview entirely for fast completion", async () => {
      renderRenderer({
        html: ["<head></head><body><div>Done</div></body>"],
        htmlComplete: true,
        generating: false,
      });
      await flushImport();

      // Only final sandbox created, no preview
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      expect(options.frameContent).toContain("Done");
      // frameContent is the assembled final document, not the empty preview template
      expect(options.frameContent).not.toBe("<head></head><body></body>");
    });

    it("measures height on fast completion (htmlComplete + generating:false in one snapshot)", async () => {
      // Reconnect/restore + non-streaming completion path: a single content
      // snapshot arrives already complete. The sandbox is only scheduled (async
      // import) when Effect 4 runs, so the height measurement must be queued and
      // flushed once the sandbox is ready — otherwise the iframe stays clamped
      // at initialHeight and taller content is clipped.
      renderRenderer({
        html: ["<head></head><body><div>Tall content</div></body>"],
        htmlComplete: true,
        css: "body { color: blue; }",
        cssComplete: true,
        generating: false,
      });
      // Concrete signal: wait until the sandbox has actually been created rather
      // than guessing the import chain has settled.
      await flushUntil(() => createdSandboxes.length === 1, "sandbox created");

      // Resolve the sandbox ready promise, then wait on the concrete downstream
      // signal — the host's sandbox.promise.then callback having flushed the
      // queued one-shot measurement — instead of a heuristic drain.
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushUntil(() => measureRunCount() >= 1, "measurement flushed");

      // The one-shot measurement script must have executed via the flushed queue
      expect(measureRunCount()).toBeGreaterThanOrEqual(1);
    });

    it("re-measures height when the final sandbox is rebuilt after completion", async () => {
      // A rebuild AFTER completion (here: a sandbox-functions identity change)
      // destroys the measured sandbox and resets autoHeight. Effect 4 is keyed on
      // generationDone and will NOT re-fire, so without Effect 1's re-queue the
      // new sandbox is never measured: it stays clamped at initialHeight and
      // taller content is clipped. Effect 1 must re-push the measurement AND the
      // armed __ck_resize listener must still apply the result to the height.
      const completedContent = {
        // initialHeight 200 so a stuck height is unmistakably distinct from the
        // measured 500/700 values below.
        initialHeight: 200,
        html: ["<head></head><body><div>Tall content</div></body>"],
        htmlComplete: true,
        css: "body { color: blue; }",
        cssComplete: true,
        generating: false,
      } as const;

      const handler1 = vi.fn();
      const fns1: SandboxFunction[] = [
        {
          name: "fn1",
          description: "first",
          parameters: z.object({}),
          handler: handler1,
        },
      ];

      const { container, rerender } = render(
        <SandboxFunctionsContext.Provider value={fns1}>
          <OpenGenerativeUIActivityRenderer
            activityType="open-generative-ui"
            content={completedContent}
            message={{}}
            agent={{}}
          />
        </SandboxFunctionsContext.Provider>,
      );
      // Concrete signal: the first sandbox has actually been created.
      await flushUntil(() => createdSandboxes.length === 1, "first sandbox");

      // First sandbox ready — wait on the concrete signal that its host
      // sandbox.promise.then callback has RUN and flushed the queued measurement,
      // not a heuristic that the chain "looks" settled.
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushUntil(() => measureRunCount() >= 1, "first measurement");

      // The first sandbox ran the one-shot measurement
      expect(measureRunCount()).toBeGreaterThanOrEqual(1);

      const outer = container.firstElementChild as HTMLElement;
      // Still at initialHeight until the iframe posts back its measurement.
      expect(outer.style.height).toBe("200px");

      // Dispatch the first sandbox's measured height. The source is read from the
      // recorded sandbox handle — the SAME object the renderer stored in
      // sandboxRef.current — so its stable contentWindow sentinel is exactly what
      // the listener's `e.source === sandboxRef.current?.iframe?.contentWindow`
      // guard compares against. No after-the-fact stub on the shared mockIframe,
      // so there is no window where the dispatched source and the listener-visible
      // sandbox can disagree.
      const firstSandbox = createdSandboxes.at(-1)!;
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "__ck_resize", height: 500 },
            source: firstSandbox.contentWindow,
          }),
        );
      });
      expect(outer.style.height).toBe("500px");

      // Rebuild WITHOUT changing content — only the sandbox-functions context
      // value changes (localApi identity), which re-fires Effect 1 but not
      // Effect 4. The new sandbox must still be measured and applied.
      mockRun.mockClear();
      resetMockPromise();
      const handler2 = vi.fn();
      const fns2: SandboxFunction[] = [
        {
          name: "fn2",
          description: "second",
          parameters: z.object({}),
          handler: handler2,
        },
      ];
      rerender(
        <SandboxFunctionsContext.Provider value={fns2}>
          <OpenGenerativeUIActivityRenderer
            activityType="open-generative-ui"
            content={completedContent}
            message={{}}
            agent={{}}
          />
        </SandboxFunctionsContext.Provider>,
      );
      // Concrete signal: the rebuilt sandbox has actually been created (the
      // rebuild's dynamic import resolved and Websandbox.create ran). flushUntil
      // throws if it never does, so a stuck rebuild fails loud here instead of
      // surfacing as a misleading height assertion later.
      await flushUntil(() => createdSandboxes.length === 2, "rebuilt sandbox");

      // Old sandbox destroyed, new one created
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      // Effect 1's cleanup reset autoHeight, so the height snaps back to
      // initialHeight until the rebuilt iframe posts its measurement.
      expect(outer.style.height).toBe("200px");

      // New sandbox not ready yet — measurement still queued, nothing flushed
      expect(measureRunCount()).toBe(0);

      // Resolve the second sandbox, then wait on the concrete signal that the
      // re-queued measurement has replayed — i.e. the rebuilt sandbox's host
      // sandbox.promise.then callback has RUN. This is the precise hop the old
      // call-count heuristic could not observe, so it could let the dispatch below
      // race a still-pending callback and reject the height MessageEvent.
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushUntil(() => measureRunCount() >= 1, "rebuilt measurement");

      // The second sandbox re-ran the one-shot measurement script.
      expect(measureRunCount()).toBeGreaterThanOrEqual(1);

      // Dispatch the rebuilt sandbox's measured height. Again the source is read
      // from the recorded handle (now createdSandboxes.at(-1), the object in
      // sandboxRef.current after the rebuild), so it is guaranteed to match the
      // listener's current-sandbox guard — the height-700 event can no longer be
      // rejected for pointing at a stale or not-yet-armed contentWindow.
      const secondSandbox = createdSandboxes.at(-1)!;
      expect(secondSandbox).not.toBe(firstSandbox);

      // RED pre-fix: the listener was a one-shot that removed itself after the
      // first (500px) measurement, so this second post is never received and the
      // height stays stuck at 200px. GREEN post-fix: the still-armed listener
      // applies the rebuilt sandbox's measurement.
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "__ck_resize", height: 700 },
            source: secondSandbox.contentWindow,
          }),
        );
      });
      expect(outer.style.height).toBe("700px");
    });
  });

  describe("design-system / importmap injection", () => {
    // Test A — defaults (no provider override): design system kit and importmap
    // are injected before the agent's body content in the final sandbox document.
    it("injects importmap and design-system kit before agent content (defaults)", async () => {
      const agentBody = "<body><p>Agent content</p></body>";
      renderRenderer({
        html: [`<head></head>${agentBody}`],
        htmlComplete: true,
      });
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      const frameContent: string = options.frameContent;

      // Both kit markers must be present
      expect(frameContent).toContain("data-ck-design-system");
      expect(frameContent).toContain('<script type="importmap">');

      // Cascade order: importmap and kit must appear before the agent body content
      const importmapIdx = frameContent.indexOf('<script type="importmap">');
      const kitIdx = frameContent.indexOf("data-ck-design-system");
      const bodyContentIdx = frameContent.indexOf("<p>Agent content</p>");

      expect(importmapIdx).toBeGreaterThan(-1);
      expect(kitIdx).toBeGreaterThan(-1);
      expect(bodyContentIdx).toBeGreaterThan(-1);

      expect(importmapIdx).toBeLessThan(bodyContentIdx);
      expect(kitIdx).toBeLessThan(bodyContentIdx);
    });

    // Test B — disabled (legacy backward-compat): with designSystemCss: false and
    // importMap: false the frameContent must be byte-identical to the input html.
    it("passes frameContent through unchanged when kit and importmap are disabled", async () => {
      const inputHtml =
        "<head><title>Legacy</title></head><body><p>Legacy content</p></body>";

      render(
        <OpenGenerativeUIOptionsProvider
          value={{ designSystemCss: false, importMap: false }}
        >
          <OpenGenerativeUIActivityRenderer
            activityType="open-generative-ui"
            content={{ html: [inputHtml], htmlComplete: true }}
            message={{}}
            agent={{}}
          />
        </OpenGenerativeUIOptionsProvider>,
      );
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];

      // Backward-compat invariant: no kit, no importmap, no extra style injected
      expect(options.frameContent).toBe(inputHtml);
    });

    // Test C — preview streaming path: the document.head.innerHTML run call must
    // include data-ck-design-system BEFORE any agent css <style> content.
    it("injects design-system kit before agent css in preview head update", async () => {
      const agentCss = "body { color: hotpink; }";

      render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            css: agentCss,
            cssComplete: true,
            html: ["<body><div>Preview body</div>"],
            htmlComplete: false,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox is created
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Resolve the preview sandbox promise so the head/body run calls fire
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // Find the sandbox.run call that sets document.head.innerHTML
      const headCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      expect(headCalls.length).toBeGreaterThanOrEqual(1);

      const headPayload: string = headCalls[0][0] as string;

      // Both the kit and the agent css must be present
      expect(headPayload).toContain("data-ck-design-system");
      expect(headPayload).toContain(agentCss);

      // Cascade order: kit must appear before agent css
      const kitIdx = headPayload.indexOf("data-ck-design-system");
      const agentCssIdx = headPayload.indexOf(agentCss);
      expect(kitIdx).toBeLessThan(agentCssIdx);
    });

    // Test D — the overflow-hidden guard style must survive the head assignment.
    // The head innerHTML assignment used to clobber a separately-appended overflow
    // style; the guard must now be baked into the assigned head content so the
    // preview iframe never shows scrollbars.
    it("keeps the overflow guard in the head assignment alongside the kit", async () => {
      const agentCss = "body { color: hotpink; }";

      render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            css: agentCss,
            cssComplete: true,
            html: ["<body><div>Preview body</div>"],
            htmlComplete: false,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox is created
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Resolve the preview sandbox promise so the head/body run calls fire
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // Inspect the LAST document.head.innerHTML run call — it must carry BOTH
      // the overflow guard and the design-system kit (the guard survives).
      const headCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      expect(headCalls.length).toBeGreaterThanOrEqual(1);

      const headPayload: string = headCalls[headCalls.length - 1][0] as string;
      expect(headPayload).toContain("overflow: hidden");
      expect(headPayload).toContain("data-ck-design-system");
    });

    // Test E — preview cascade must match the FINAL document's cascade
    // (assembleDocument), region by region. Style extraction is region-aware:
    //
    //   * HEAD-region <style> (before the first <body>) is hoisted into the
    //     preview <head>, exactly as the final document keeps it in the head.
    //     Order there: kit -> agent's inline <style> -> agent css param LAST.
    //   * BODY-region <style> (inside <body>) STAYS in the preview body, exactly
    //     where the final document keeps it (after the head css in document
    //     order). It is NOT hoisted.
    //
    // If a body-region style were hoisted (the old behavior) it would flip
    // cascade position at the preview -> final swap, visibly restyling artifacts
    // whose body <style> and the css param collide at equal specificity.

    // Case A — HEAD-region style: the preview head order (kit < inline < css)
    // matches assembleDocument's final head cascade for the same full html.
    it("orders preview head as kit -> head-region inline style -> agent css (matches final document)", async () => {
      const agentCss = "main { color: rebeccapurple; }";
      const inlineStyleContent = ".inline-block { color: seagreen; }";
      // Full html with the inline style in the HEAD (before <body>). The preview
      // receives the streaming prefix (no closing tags); the final document
      // receives the complete html. Both must order the inline style before the
      // css param and after the kit.
      const headStyle = `<head><style>${inlineStyleContent}</style></head>`;
      const previewHtml = `${headStyle}<body><div class="inline-block">Preview body</div>`;
      const fullHtml = `${headStyle}<body><div class="inline-block">Preview body</div></body>`;

      render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            css: agentCss,
            cssComplete: true,
            html: [previewHtml],
            htmlComplete: false,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox is created
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Resolve the preview sandbox promise so the head/body run calls fire
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // Read the LAST document.head.innerHTML run payload.
      const headCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      expect(headCalls.length).toBeGreaterThanOrEqual(1);
      const headPayload: string = headCalls[headCalls.length - 1][0] as string;

      // All three must be present in the assigned head content.
      const kitIdx = headPayload.indexOf("data-ck-design-system");
      const inlineStyleIdx = headPayload.indexOf(inlineStyleContent);
      const agentCssIdx = headPayload.indexOf(agentCss);
      expect(kitIdx).toBeGreaterThan(-1);
      expect(inlineStyleIdx).toBeGreaterThan(-1);
      expect(agentCssIdx).toBeGreaterThan(-1);

      // Preview cascade: kit first, then the agent's inline <style>, then the
      // agent css param LAST.
      expect(kitIdx).toBeLessThan(inlineStyleIdx);
      expect(inlineStyleIdx).toBeLessThan(agentCssIdx);

      // The FINAL document must use the SAME relative order for the same input
      // and options — that is the parity this test asserts.
      const finalDoc = assembleDocument(fullHtml, {
        css: agentCss,
        designSystemCss: DEFAULT_OPEN_GEN_UI_OPTIONS.designSystemCss,
        importMap: DEFAULT_OPEN_GEN_UI_OPTIONS.importMap,
      });
      const finalKitIdx = finalDoc.indexOf("data-ck-design-system");
      const finalInlineIdx = finalDoc.indexOf(inlineStyleContent);
      const finalCssIdx = finalDoc.indexOf(agentCss);
      expect(finalKitIdx).toBeGreaterThan(-1);
      expect(finalInlineIdx).toBeGreaterThan(-1);
      expect(finalCssIdx).toBeGreaterThan(-1);
      expect(finalKitIdx).toBeLessThan(finalInlineIdx);
      expect(finalInlineIdx).toBeLessThan(finalCssIdx);
    });

    // Case B — BODY-region style: the style stays in the PREVIEW BODY (the body
    // innerHTML run call contains it; the head payload does NOT), matching the
    // final document where a body-region style also sits in the body after the
    // head css.
    //
    // RED pre-fix: extractCompleteStyles hoisted EVERY style, so this body style
    // was injected into the preview head and stripped from the preview body —
    // the opposite of the final document. GREEN post-fix: it is left in the body.
    it("keeps a body-region style in the preview body, not the head (matches final document)", async () => {
      const agentCss = "main { color: rebeccapurple; }";
      const bodyStyleContent = ".body-block { color: seagreen; }";
      // The complete <style> sits INSIDE <body>, so it is body-region.
      const bodyStyleTag = `<style>${bodyStyleContent}</style>`;
      const previewHtml = `<body><div class="body-block">Preview body</div>${bodyStyleTag}`;

      render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            css: agentCss,
            cssComplete: true,
            html: [previewHtml],
            htmlComplete: false,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox is created
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Resolve the preview sandbox promise so the head/body run calls fire
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // The body innerHTML run call must contain the body-region style block.
      const bodyCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(bodyCalls.length).toBeGreaterThanOrEqual(1);
      const bodyPayload: string = bodyCalls[bodyCalls.length - 1][0] as string;
      expect(bodyPayload).toContain(bodyStyleContent);

      // The head payload must NOT contain the body-region style (it was not
      // hoisted) — only the kit and the agent css param.
      const headCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      expect(headCalls.length).toBeGreaterThanOrEqual(1);
      const headPayload: string = headCalls[headCalls.length - 1][0] as string;
      expect(headPayload).not.toContain(bodyStyleContent);
      expect(headPayload).toContain("data-ck-design-system");
      expect(headPayload).toContain(agentCss);

      // Final-document parity: a body-region style stays in the BODY, after the
      // head css in document order (the head css index precedes the body style
      // index), so the preview and final cascades agree.
      const fullHtml = `<body><div class="body-block">Preview body</div>${bodyStyleTag}</body>`;
      const finalDoc = assembleDocument(fullHtml, {
        css: agentCss,
        designSystemCss: DEFAULT_OPEN_GEN_UI_OPTIONS.designSystemCss,
        importMap: DEFAULT_OPEN_GEN_UI_OPTIONS.importMap,
      });
      const finalCssIdx = finalDoc.indexOf(agentCss);
      const finalBodyStyleIdx = finalDoc.indexOf(bodyStyleContent);
      expect(finalCssIdx).toBeGreaterThan(-1);
      expect(finalBodyStyleIdx).toBeGreaterThan(-1);
      expect(finalCssIdx).toBeLessThan(finalBodyStyleIdx);
    });

    // Case F — TOP-LEVEL pre-<body> style (no enclosing <head> element): it is
    // NOT hoisted. assembleDocument leaves a top-level pre-<body> style in the
    // body region (after the head css in document order), so the preview must
    // keep it in the body and out of the head — exactly like a body-region
    // style. This is the parity case for the shared masked-boundary rule: the
    // hoist decision never depends on <body> detection, only on whether the
    // style sits inside a complete <head> element (here it does not).
    //
    // RED pre-fix: extractCompleteStyles hoisted any style before <body>, so the
    // top-level style was injected into the preview head and stripped from the
    // body — the opposite of the final document. GREEN post-fix: left in body.
    it("keeps a top-level pre-<body> style in the preview body, not the head (matches final document)", async () => {
      const agentCss = "main { color: rebeccapurple; }";
      const preBodyStyleContent = ".pre-body-block { color: seagreen; }";
      // The complete <style> sits at the TOP LEVEL, before <body>, with no
      // enclosing <head> element — so it is body-region per the final document.
      const preBodyStyleTag = `<style>${preBodyStyleContent}</style>`;
      const previewHtml = `${preBodyStyleTag}<body><div class="pre-body-block">Preview body</div>`;

      render(
        <OpenGenerativeUIActivityRenderer
          activityType="open-generative-ui"
          content={{
            css: agentCss,
            cssComplete: true,
            html: [previewHtml],
            htmlComplete: false,
            generating: true,
          }}
          message={{}}
          agent={{}}
        />,
      );
      await flushImport();

      // Preview sandbox is created
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Resolve the preview sandbox promise so the head/body run calls fire
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // The body innerHTML run call must contain the top-level pre-<body> style.
      const bodyCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(bodyCalls.length).toBeGreaterThanOrEqual(1);
      const bodyPayload: string = bodyCalls[bodyCalls.length - 1][0] as string;
      expect(bodyPayload).toContain(preBodyStyleContent);

      // The head payload must NOT contain the pre-<body> style (not hoisted) —
      // only the kit and the agent css param.
      const headCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      expect(headCalls.length).toBeGreaterThanOrEqual(1);
      const headPayload: string = headCalls[headCalls.length - 1][0] as string;
      expect(headPayload).not.toContain(preBodyStyleContent);
      expect(headPayload).toContain("data-ck-design-system");
      expect(headPayload).toContain(agentCss);

      // Final-document parity: the top-level pre-<body> style stays in the BODY,
      // after the head css in document order (head css index precedes the style
      // index), so the preview and final cascades agree.
      const fullHtml = `${preBodyStyleTag}<body><div class="pre-body-block">Preview body</div></body>`;
      const finalDoc = assembleDocument(fullHtml, {
        css: agentCss,
        designSystemCss: DEFAULT_OPEN_GEN_UI_OPTIONS.designSystemCss,
        importMap: DEFAULT_OPEN_GEN_UI_OPTIONS.importMap,
      });
      const finalCssIdx = finalDoc.indexOf(agentCss);
      const finalPreBodyStyleIdx = finalDoc.indexOf(preBodyStyleContent);
      expect(finalCssIdx).toBeGreaterThan(-1);
      expect(finalPreBodyStyleIdx).toBeGreaterThan(-1);
      expect(finalCssIdx).toBeLessThan(finalPreBodyStyleIdx);
    });
  });
});
