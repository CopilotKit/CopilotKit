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

const mockCreate = vi.fn(() => {
  mockIframe = document.createElement("iframe");
  return {
    iframe: mockIframe,
    promise: mockPromise,
    run: mockRun,
    destroy: mockDestroy,
  };
});

vi.mock("@jetbrains/websandbox", () => ({
  default: {
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

/** Flush the dynamic import() microtask so the sandbox gets created */
async function flushImport() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
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
  });

  afterEach(() => {
    cleanup();
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

      // Wait for the 1s throttle window to pass
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1100));
      });
      await flushImport();

      // Should have updated innerHTML with new content after throttle
      const updateCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      expect(updateCalls[updateCalls.length - 1]![0]).toContain("World");
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
      await flushImport();

      // Resolve the sandbox ready promise so the pending queue is flushed
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // The one-shot measurement script must have executed via the flushed queue
      const measureCalls = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("__ck_resize"),
      );
      expect(measureCalls.length).toBeGreaterThanOrEqual(1);
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
      await flushImport();

      // First sandbox ready — flush its queued measurement
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // The first sandbox ran the one-shot measurement
      const measureCallsFirst = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("__ck_resize"),
      );
      expect(measureCallsFirst.length).toBeGreaterThanOrEqual(1);

      const outer = container.firstElementChild as HTMLElement;
      // Still at initialHeight until the iframe posts back its measurement.
      expect(outer.style.height).toBe("200px");

      // The mock creates a fresh, DETACHED iframe per sandbox; a detached
      // iframe's contentWindow is null in jsdom, so stub it with a sentinel
      // window object and use that same object as the MessageEvent source the
      // armed listener compares against (sandboxRef.current.iframe.contentWindow).
      const firstWindow = {} as Window;
      Object.defineProperty(mockIframe, "contentWindow", {
        configurable: true,
        value: firstWindow,
      });

      // The first sandbox posts its measured height — the listener applies it.
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "__ck_resize", height: 500 },
            source: firstWindow,
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
      await flushImport();

      // Old sandbox destroyed, new one created
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      // Effect 1's cleanup reset autoHeight, so the height snaps back to
      // initialHeight until the rebuilt iframe posts its measurement.
      expect(outer.style.height).toBe("200px");

      // New sandbox not ready yet — measurement still queued, nothing flushed
      const measureBeforeReady = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("__ck_resize"),
      );
      expect(measureBeforeReady.length).toBe(0);

      // Resolve the second sandbox — the re-queued measurement must replay
      await act(async () => {
        mockPromiseResolve();
        await mockPromise;
      });
      await flushImport();

      // The second sandbox re-ran the one-shot measurement script.
      const measureCallsSecond = mockRun.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" && (c[0] as string).includes("__ck_resize"),
      );
      expect(measureCallsSecond.length).toBeGreaterThanOrEqual(1);

      // Stub the SECOND (now current) iframe's contentWindow with a distinct
      // sentinel — mockCreate reassigned the module-level mockIframe on rebuild.
      const secondWindow = {} as Window;
      Object.defineProperty(mockIframe, "contentWindow", {
        configurable: true,
        value: secondWindow,
      });

      // RED pre-fix: the listener was a one-shot that removed itself after the
      // first (500px) measurement, so this second post is never received and the
      // height stays stuck at 200px. GREEN post-fix: the still-armed listener
      // applies the rebuilt sandbox's measurement.
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "__ck_resize", height: 700 },
            source: secondWindow,
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
  });
});
