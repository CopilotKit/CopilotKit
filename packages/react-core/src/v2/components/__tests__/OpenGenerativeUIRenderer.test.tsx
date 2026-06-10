import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { z } from "zod";
import type { OpenGenerativeUIContent } from "../OpenGenerativeUIRenderer";
import { OpenGenerativeUIActivityRenderer } from "../OpenGenerativeUIRenderer";
import { SandboxFunctionsContext } from "../../providers/SandboxFunctionsContext";
import { OpenGenerativeUIOptionsProvider } from "../../providers/OpenGenerativeUIOptionsContext";
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
  });
});
