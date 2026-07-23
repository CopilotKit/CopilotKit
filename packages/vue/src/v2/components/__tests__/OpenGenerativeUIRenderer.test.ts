import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/vue";
import { ref } from "vue";
import type { Ref } from "vue";
import { OpenGenerativeUIActivityRenderer } from "../OpenGenerativeUIRenderer";
import type { OpenGenerativeUIContent } from "../OpenGenerativeUIRenderer";
import { SandboxFunctionsKey } from "../../providers/keys";
import type { SandboxFunction } from "../../types";
import { z } from "zod";

const mockRun = vi.fn().mockResolvedValue(undefined);
const mockDestroy = vi.fn();
let mockPromiseResolve: () => void;
let mockPromise: Promise<unknown>;

function resetMockPromise() {
  mockPromise = new Promise<void>((resolve) => {
    mockPromiseResolve = resolve;
  });
}

type SandboxOptions = { frameContent?: string } & Record<string, unknown>;
type MockCreateFn = (
  localApi: Record<string, unknown>,
  options: SandboxOptions,
) => {
  iframe: HTMLIFrameElement;
  promise: Promise<unknown>;
  run: typeof mockRun;
  destroy: typeof mockDestroy;
};

const mockCreate = vi.fn<MockCreateFn>(() => ({
  iframe: document.createElement("iframe"),
  promise: mockPromise,
  run: mockRun,
  destroy: mockDestroy,
}));

vi.mock("@jetbrains/websandbox", () => ({
  default: {
    create: (localApi: Record<string, unknown>, options: SandboxOptions) =>
      mockCreate(localApi, options),
  },
}));

async function flushImport() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderRenderer(
  content: OpenGenerativeUIContent,
  sandboxFunctionsOrRef:
    | readonly SandboxFunction[]
    | Ref<readonly SandboxFunction[]> = [],
) {
  const sandboxFunctionsRef =
    typeof (sandboxFunctionsOrRef as Ref<readonly SandboxFunction[]>).value !==
    "undefined"
      ? (sandboxFunctionsOrRef as Ref<readonly SandboxFunction[]>)
      : ref(sandboxFunctionsOrRef as readonly SandboxFunction[]);

  return render(OpenGenerativeUIActivityRenderer, {
    props: {
      activityType: "open-generative-ui",
      content,
      message: {},
      agent: undefined,
    },
    global: {
      provide: {
        [SandboxFunctionsKey as symbol]: sandboxFunctionsRef,
      },
    },
  });
}

describe("OpenGenerativeUIRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockPromise();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders placeholder when no html", async () => {
    const { getByTestId, queryByTestId } = renderRenderer({
      initialHeight: 300,
    });
    await flushImport();
    expect(getByTestId("open-generative-ui-placeholder")).not.toBeNull();
    expect(queryByTestId("open-generative-ui-final-sandbox")).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates final sandbox when html is complete", async () => {
    renderRenderer({
      html: ["<head></head><body><p>Hello</p></body>"],
      htmlComplete: true,
    });
    await flushImport();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toContain("Hello");
  });

  it("creates preview sandbox when streaming", async () => {
    renderRenderer({
      html: ["<body><p>Partial</p>"],
      htmlComplete: false,
      cssComplete: true,
    });
    await flushImport();
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toBe("<head></head><body></body>");
  });

  it("wraps html missing head", async () => {
    renderRenderer({
      html: ["<body><p>No head</p></body>"],
      htmlComplete: true,
    });
    await flushImport();
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toContain("<head></head>");
  });

  it("joins html chunks when complete", async () => {
    renderRenderer({
      html: ["<head></head>", "<body>", "<p>Hello</p>", "</body>"],
      htmlComplete: true,
    });
    await flushImport();
    const [, options] = mockCreate.mock.calls[0];
    expect(options.frameContent).toContain("<p>Hello</p>");
  });

  it("injects jsFunctions via sandbox run", async () => {
    renderRenderer({
      html: ["<head></head><body><div>App</div></body>"],
      htmlComplete: true,
      jsFunctions: "function greet() { return 'hi'; }",
    });
    await flushImport();
    mockPromiseResolve();
    await mockPromise;
    await flushImport();
    expect(mockRun).toHaveBeenCalledWith("function greet() { return 'hi'; }");
  });

  it("recreates sandbox when html changes", async () => {
    const first = renderRenderer({
      html: ["<head></head><body>v1</body>"],
      htmlComplete: true,
    });
    await flushImport();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    mockPromiseResolve();
    await mockPromise;

    resetMockPromise();
    first.rerender({
      activityType: "open-generative-ui",
      content: {
        html: ["<head></head><body>v2</body>"],
        htmlComplete: true,
      },
      message: {},
      agent: {},
    });
    await flushImport();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const [, options] = mockCreate.mock.calls[1];
    expect(options.frameContent).toContain("v2");
  });

  it("destroys sandbox on unmount", async () => {
    const mounted = renderRenderer({
      html: ["<head></head><body>bye</body>"],
      htmlComplete: true,
    });
    await flushImport();
    mounted.unmount();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("executes jsExpressions sequentially", async () => {
    renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
      jsExpressions: ["expr1()", "expr2()"],
    });
    await flushImport();
    mockPromiseResolve();
    await mockPromise;
    await flushImport();

    const exprCalls = mockRun.mock.calls
      .map((c) => c[0])
      .filter((c) => typeof c === "string" && c.startsWith("expr"));
    expect(exprCalls).toEqual(["expr1()", "expr2()"]);
  });

  it("does not re-execute prior jsExpressions on rerender", async () => {
    const mounted = renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
      jsExpressions: ["expr1()"],
    });
    await flushImport();
    mockPromiseResolve();
    await mockPromise;
    await flushImport();

    mounted.rerender({
      activityType: "open-generative-ui",
      content: {
        html: ["<head></head><body></body>"],
        htmlComplete: true,
        jsExpressions: ["expr1()", "expr2()"],
      },
      message: {},
      agent: {},
    });
    await flushImport();

    const exprCalls = mockRun.mock.calls
      .map((c) => c[0])
      .filter((c) => c === "expr1()" || c === "expr2()");
    expect(exprCalls.filter((x) => x === "expr1()")).toHaveLength(1);
    expect(exprCalls.filter((x) => x === "expr2()")).toHaveLength(1);
  });

  it("queues JS before sandbox readiness and flushes after promise resolves", async () => {
    renderRenderer({
      html: ["<head></head><body></body>"],
      htmlComplete: true,
      jsFunctions: "function foo() {}",
      jsExpressions: ["foo()"],
    });
    await flushImport();

    expect(
      mockRun.mock.calls.some(
        (c) => c[0] === "function foo() {}" || c[0] === "foo()",
      ),
    ).toBe(false);

    mockPromiseResolve();
    await mockPromise;
    await flushImport();
    expect(mockRun).toHaveBeenCalledWith("function foo() {}");
    expect(mockRun).toHaveBeenCalledWith("foo()");
  });

  it("passes localApi built from sandbox functions to websandbox", async () => {
    const handler = vi.fn().mockResolvedValue(42);
    const sandboxFunctions: SandboxFunction[] = [
      {
        name: "addToCart",
        description: "Add item to cart",
        parameters: z.object({ itemId: z.string() }),
        handler,
      },
    ];

    renderRenderer(
      {
        html: ["<head></head><body>test</body>"],
        htmlComplete: true,
      },
      sandboxFunctions,
    );
    await flushImport();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [localApi] = mockCreate.mock.calls[0]!;
    expect(localApi).toHaveProperty("addToCart");
    expect(localApi.addToCart).toBe(handler);
  });

  it("passes empty localApi with no functions", async () => {
    renderRenderer(
      {
        html: ["<head></head><body>test</body>"],
        htmlComplete: true,
      },
      [],
    );
    await flushImport();
    const [localApi] = mockCreate.mock.calls[0];
    expect(Object.keys(localApi as object)).toHaveLength(0);
  });

  it("passes multiple sandbox functions via localApi", async () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const sandboxFunctions: SandboxFunction[] = [
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
    renderRenderer(
      {
        html: ["<head></head><body>multi</body>"],
        htmlComplete: true,
      },
      sandboxFunctions,
    );
    await flushImport();
    const [localApi] = mockCreate.mock.calls[0]!;
    expect(Object.keys(localApi)).toHaveLength(2);
    expect(localApi.fnA).toBe(handlerA);
    expect(localApi.fnB).toBe(handlerB);
  });

  it("recreates sandbox when sandbox functions change", async () => {
    const handlerA = vi.fn();
    const functionsRef = ref<readonly SandboxFunction[]>([
      {
        name: "fnA",
        description: "A",
        parameters: z.object({}),
        handler: handlerA,
      },
    ]);
    const mounted = renderRenderer(
      {
        html: ["<head></head><body>reactive</body>"],
        htmlComplete: true,
      },
      functionsRef,
    );
    await flushImport();
    expect(mockCreate).toHaveBeenCalledTimes(1);

    mockPromiseResolve();
    await mockPromise;
    resetMockPromise();

    const handlerB = vi.fn();
    functionsRef.value = [
      {
        name: "fnB",
        description: "B",
        parameters: z.object({}),
        handler: handlerB,
      },
    ];
    await mounted.rerender({
      activityType: "open-generative-ui",
      content: {
        html: ["<head></head><body>reactive</body>"],
        htmlComplete: true,
      },
      message: {},
      agent: {},
    });
    await flushImport();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const [localApi] = mockCreate.mock.calls[1]!;
    expect(Object.keys(localApi)).toEqual(["fnB"]);
    expect(localApi.fnB).toBe(handlerB);
  });

  describe("progressive streaming preview", () => {
    it("creates preview when chunks arrive during streaming", async () => {
      renderRenderer({
        html: ["<body><div>Hello</div>"],
        htmlComplete: false,
        cssComplete: true,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      expect(options.frameContent).toBe("<head></head><body></body>");
    });

    it("updates preview after throttled rerender", async () => {
      const mounted = renderRenderer({
        html: ["<body><div>Hello</div>"],
        htmlComplete: false,
        cssComplete: true,
        generating: true,
      });
      await flushImport();

      mockPromiseResolve();
      await mockPromise;
      await flushImport();
      mockRun.mockClear();

      mounted.rerender({
        activityType: "open-generative-ui",
        content: {
          html: ["<body><div>Hello</div>", "<p>World</p>"],
          htmlComplete: false,
          cssComplete: true,
          generating: true,
        },
        message: {},
        agent: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 1100));
      await flushImport();

      const bodyCalls = mockRun.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("document.body.innerHTML"),
      );
      expect(bodyCalls.length).toBeGreaterThan(0);
      expect(bodyCalls[bodyCalls.length - 1]?.[0]).toContain("World");
    });

    it("switches from preview to final sandbox on htmlComplete", async () => {
      const mounted = renderRenderer({
        html: ["<body><div>Hello</div>"],
        htmlComplete: false,
        cssComplete: true,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);

      resetMockPromise();
      mounted.rerender({
        activityType: "open-generative-ui",
        content: {
          html: ["<head></head><body><div>Hello</div></body>"],
          htmlComplete: true,
          cssComplete: true,
          generating: false,
        },
        message: {},
        agent: {},
      });
      await flushImport();

      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      const [, options] = mockCreate.mock.calls[1];
      expect(options.frameContent).toContain("Hello");
    });

    it("gates preview until cssComplete", async () => {
      const mounted = renderRenderer({
        html: ["<body><div>Streaming content</div>"],
        htmlComplete: false,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(0);

      mounted.rerender({
        activityType: "open-generative-ui",
        content: {
          css: "body { margin: 0; color: red; }",
          cssComplete: true,
          html: ["<body><div>Streaming content</div>"],
          htmlComplete: false,
          generating: true,
        },
        message: {},
        agent: {},
      });
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      expect(options.frameContent).toBe("<head></head><body></body>");
    });

    it("suppresses preview when body content is not meaningful", async () => {
      renderRenderer({
        html: ["<head><style>.foo { color: red; }</style></head>"],
        htmlComplete: false,
        cssComplete: true,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(0);
    });

    it("skips preview for fast completion", async () => {
      renderRenderer({
        html: ["<head></head><body><div>Done</div></body>"],
        htmlComplete: true,
        generating: false,
      });
      await flushImport();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      expect(options.frameContent).toContain("Done");
      expect(options.frameContent).not.toBe("<head></head><body></body>");
    });
  });
});
