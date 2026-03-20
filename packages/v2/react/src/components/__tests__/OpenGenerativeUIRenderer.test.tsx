import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIContent,
} from "../OpenGenerativeUIRenderer";

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

  it("creates sandbox when html arrives", async () => {
    const html = "<head></head><body><p>Hello</p></body>";
    renderRenderer({ html });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toBe(html);
    expect(options.frameContainer).toBeInstanceOf(HTMLElement);
  });

  it("wraps html missing <head>", async () => {
    renderRenderer({ html: "<body><p>No head</p></body>" });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toContain("<head></head>");
  });

  it("destroys sandbox on unmount", async () => {
    const { unmount } = renderRenderer({ html: "<head></head><body></body>" });
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("injects jsFunctions via run()", async () => {
    const jsFunctions = "function greet() { return 'hi'; }";
    renderRenderer({
      html: "<head></head><body></body>",
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
      html: "<head></head><body></body>",
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
          html: "<head></head><body></body>",
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
          html: "<head></head><body></body>",
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
      html: "<head></head><body></body>",
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
        content={{ html: "<head></head><body>v1</body>" }}
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
        content={{ html: "<head></head><body>v2</body>" }}
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
});
