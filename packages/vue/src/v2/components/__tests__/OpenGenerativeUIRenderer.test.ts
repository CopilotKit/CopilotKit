import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/vue";
import { nextTick, ref } from "vue";
import type { Ref } from "vue";
import { ToolCallStatus } from "@copilotkit/core";
import {
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIToolRenderer,
} from "../OpenGenerativeUIRenderer";
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

// The renderer's content watcher throttles non-immediate changes with
// window.setTimeout(flush, THROTTLE_MS). Keep this in lockstep with the 1000ms
// throttle window in the source.
const THROTTLE_MS = 1000;

/**
 * Fake-timer-safe drain of the Vue scheduler + the dynamic-import / sandbox-ready
 * microtask chain the renderer kicks off (the `import("@jetbrains/websandbox")`
 * resolve, its `.then` running `create`, and the `sandbox.promise.then` ready
 * callback are each a microtask hop, interleaved with Vue reactive re-renders).
 * Uses ONLY microtask hops (`Promise.resolve()`) and `nextTick` — NO real timer
 * — so, unlike `flushImport`'s `setTimeout(0)`, it does not hang under
 * `vi.useFakeTimers()`. Mirrors react-core's fake-timer-safe `flushImport` loop.
 */
async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

/**
 * Advance the renderer's throttle window deterministically. Under
 * `vi.useFakeTimers()` we step exactly THROTTLE_MS so the deferred flush fires
 * (no wall-clock margin a loaded parallel worker can blow through), then drain
 * the scheduler + microtask chain the resulting reactive update queues (the
 * preview head/body `run` calls). Requires `vi.useFakeTimers()` to be active —
 * it uses NO real timer. Mirrors react-core's `flushThrottle`.
 */
async function flushThrottle() {
  await vi.advanceTimersByTimeAsync(THROTTLE_MS);
  await flushMicrotasks();
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
      // Deterministic throttle: drive the whole test with fake timers and step
      // exactly THROTTLE_MS for the deferred flush, instead of racing a real
      // 1100ms wall-clock wait against the renderer's 1000ms throttle (the
      // ~100ms margin a loaded parallel worker could blow through). Fake timers
      // are enabled from the START so the sandbox-setup chain and the rerender's
      // throttle timer share one fake clock; flushMicrotasks drains the
      // import/promise chain without a real timer. vi.useRealTimers() in
      // afterEach restores real timers.
      vi.useFakeTimers();
      const mounted = renderRenderer({
        html: ["<body><div>Hello</div>"],
        htmlComplete: false,
        cssComplete: true,
        generating: true,
      });
      // Drain the dynamic import + Websandbox.create chain (fake-timer-safe).
      await flushMicrotasks();

      // Resolve the preview sandbox's ready promise, then drain the resulting
      // head/body assignment (the initial content is an immediate flush, so no
      // throttle timer is pending after this).
      mockPromiseResolve();
      await flushMicrotasks();
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

      // Advance exactly the throttle window so the deferred flush fires, then
      // drain the reactive update it queues.
      await flushThrottle();

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

  // -------------------------------------------------------------------------
  // Preview cascade must match the FINAL document's cascade, region by region.
  // The final document (ensureHead + injectCssIntoHtml) injects the agent css
  // immediately before </head>, i.e. AFTER any existing head content. So the
  // preview head must order extracted head styles BEFORE the agent css. A
  // body-region style stays in the preview BODY, matching the final document
  // where it sits in the body after the head css.
  // -------------------------------------------------------------------------
  describe("preview cascade parity", () => {
    function lastHeadPayload(): string | undefined {
      const headCalls = mockRun.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.head.innerHTML"),
      );
      return headCalls.length
        ? (headCalls[headCalls.length - 1]![0] as string)
        : undefined;
    }
    function lastBodyPayload(): string | undefined {
      const bodyCalls = mockRun.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("document.body.innerHTML"),
      );
      return bodyCalls.length
        ? (bodyCalls[bodyCalls.length - 1]![0] as string)
        : undefined;
    }

    // Case A — HEAD-region style: the preview head order (extracted head style
    // < agent css) matches the final document, where injectCssIntoHtml puts the
    // agent css after the existing head content (immediately before </head>).
    //
    // RED pre-fix: the renderer pushed the agent css BEFORE the extracted style,
    // flipping the cascade relative to the final document. GREEN post-fix: the
    // extracted style precedes the agent css.
    it("orders preview head as head-region style -> agent css (matches final document)", async () => {
      const agentCss = "main { color: rebeccapurple; }";
      const inlineStyleContent = ".inline-block { color: seagreen; }";
      // Inline style in the HEAD element (before <body>). The preview receives
      // the streaming prefix (no closing tags); both must order the inline style
      // before the agent css param.
      const previewHtml = `<head><style>${inlineStyleContent}</style></head><body><div class="inline-block">Preview body</div>`;

      renderRenderer({
        css: agentCss,
        cssComplete: true,
        html: [previewHtml],
        htmlComplete: false,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);

      mockPromiseResolve();
      await mockPromise;
      await flushImport();

      const headPayload = lastHeadPayload();
      expect(headPayload).toBeDefined();
      const inlineStyleIdx = headPayload!.indexOf(inlineStyleContent);
      const agentCssIdx = headPayload!.indexOf(agentCss);
      expect(inlineStyleIdx).toBeGreaterThan(-1);
      expect(agentCssIdx).toBeGreaterThan(-1);
      // Preview cascade: extracted head style first, agent css param LAST.
      expect(inlineStyleIdx).toBeLessThan(agentCssIdx);
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
      const previewHtml = `<body><div class="body-block">Preview body</div><style>${bodyStyleContent}</style>`;

      renderRenderer({
        css: agentCss,
        cssComplete: true,
        html: [previewHtml],
        htmlComplete: false,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);

      mockPromiseResolve();
      await mockPromise;
      await flushImport();

      const headPayload = lastHeadPayload();
      const bodyPayload = lastBodyPayload();
      // Body-region style lives in the body payload, never hoisted to the head.
      expect(bodyPayload).toBeDefined();
      expect(bodyPayload!).toContain(bodyStyleContent);
      if (headPayload) expect(headPayload).not.toContain(bodyStyleContent);
      // The agent css is still applied to the head.
      expect(headPayload).toBeDefined();
      expect(headPayload!).toContain(agentCss);
    });

    // Case C — the overflow guard must survive every `document.head.innerHTML`
    // assignment. The preview sandbox shows scrollbars unless `html, body {
    // overflow: hidden }` is part of the assigned head content: a one-time
    // appendChild on ready is clobbered by the first head reassignment built
    // from headParts (extracted styles + agent css). Mirroring react-core's
    // buildPreviewHeadHtml, the guard must be the FIRST part of the head payload
    // on EVERY assignment.
    //
    // RED pre-fix: the head payload contained only the extracted styles + agent
    // css, no guard. GREEN post-fix: the guard leads the payload, then extracted
    // styles, then agent css.
    it("keeps the overflow guard first in the head assignment, then extracted styles, then agent css", async () => {
      const agentCss = "main { color: rebeccapurple; }";
      const inlineStyleContent = ".inline-block { color: seagreen; }";
      const previewHtml = `<head><style>${inlineStyleContent}</style></head><body><div class="inline-block">Preview body</div>`;

      renderRenderer({
        css: agentCss,
        cssComplete: true,
        html: [previewHtml],
        htmlComplete: false,
        generating: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);

      mockPromiseResolve();
      await mockPromise;
      await flushImport();

      const headPayload = lastHeadPayload();
      expect(headPayload).toBeDefined();
      const guardIdx = headPayload!.indexOf(
        "html, body { overflow: hidden !important; }",
      );
      const inlineStyleIdx = headPayload!.indexOf(inlineStyleContent);
      const agentCssIdx = headPayload!.indexOf(agentCss);
      expect(guardIdx).toBeGreaterThan(-1);
      expect(inlineStyleIdx).toBeGreaterThan(-1);
      expect(agentCssIdx).toBeGreaterThan(-1);
      // Guard FIRST, then extracted styles, then agent css.
      expect(guardIdx).toBeLessThan(inlineStyleIdx);
      expect(inlineStyleIdx).toBeLessThan(agentCssIdx);
    });
  });

  // -------------------------------------------------------------------------
  // FINAL document head normalization for websandbox mounting.
  //
  // @jetbrains/websandbox@1.1.3 hard-requires the EXACT literal lowercase token
  // `<head>` in frameContent: validateOptions throws when
  // `!frameContent.includes('<head>')`, and it injects its bootstrap via
  // `frameContent.replace('<head>', …)` (both case-sensitive on the 6-char
  // token). An agent-emitted `<HEAD>` or `<head lang="en">` therefore both fails
  // mounting (stuck spinner) and, even if it slipped past, never receives the
  // bootstrap. The final-document helpers must normalize the head-open token to
  // the literal `<head>` and inject the agent css INSIDE the existing head
  // (after author content, before the close) so the documented cascade holds:
  // author head styles first, agent css last — matching react-core.
  // -------------------------------------------------------------------------
  describe("final document head normalization (websandbox)", () => {
    function finalFrameContent(): string {
      const finalCall = mockCreate.mock.calls.find(
        ([, options]) =>
          typeof options.frameContent === "string" &&
          options.frameContent !== "<head></head><body></body>",
      );
      return (finalCall?.[1].frameContent as string) ?? "";
    }

    // Case 1 — uppercase <HEAD>…</HEAD>, NO css. ensureHead matched the head
    // case-insensitively and left the uppercase token verbatim, so frameContent
    // had no literal `<head>` → websandbox.validateOptions throws → never mounts.
    // GREEN post-fix: the open token is normalized to the literal `<head>`.
    it("normalizes an uppercase head with no css so frameContent has the literal <head>", async () => {
      renderRenderer({
        html: ["<HEAD><title>t</title></HEAD><body>x</body>"],
        htmlComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();
      // websandbox's literal-head gate is satisfied.
      expect(frameContent).toContain("<head>");
      // The author's head content survives the normalization.
      expect(frameContent).toContain("<title>t</title>");
    });

    // Case 2 — attributed <head lang="en">…</head> WITH css. injectCssIntoHtml
    // found </head> and injected before it, but the only head-open token was the
    // attributed `<head lang="en">` → no literal `<head>` → websandbox throws.
    // GREEN post-fix: the literal `<head>` is present AND the agent css <style>
    // sits INSIDE the real head — after the author's title, before the close.
    it("normalizes an attributed head with css so the literal <head> is present and css lands inside the real head", async () => {
      const agentCss = ".a{color:red}";
      renderRenderer({
        html: ['<head lang="en"><title>t</title></head><body>x</body>'],
        htmlComplete: true,
        css: agentCss,
        cssComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();
      // websandbox's literal-head gate is satisfied.
      expect(frameContent).toContain("<head>");
      // The agent css must sit INSIDE the real head element.
      const headOpenIdx = frameContent.indexOf("<head>");
      const headCloseIdx = frameContent.toLowerCase().indexOf("</head>");
      const titleIdx = frameContent.indexOf("<title>t</title>");
      const cssIdx = frameContent.indexOf(agentCss);
      expect(headOpenIdx).toBeGreaterThan(-1);
      expect(headCloseIdx).toBeGreaterThan(-1);
      expect(cssIdx).toBeGreaterThan(-1);
      // css is between the head-open and head-close (inside the real head).
      expect(cssIdx).toBeGreaterThan(headOpenIdx);
      expect(cssIdx).toBeLessThan(headCloseIdx);
      // Cascade: author head content (title) precedes the agent css.
      expect(titleIdx).toBeGreaterThan(-1);
      expect(titleIdx).toBeLessThan(cssIdx);
    });

    // Case 3 (cascade) — uppercase head WITH css. injectCssIntoHtml's
    // case-sensitive indexOf("</head>") missed the uppercase `</HEAD>`, so it
    // PREPENDED a fresh `<head><style>…</style></head>` before the author's
    // uppercase head — two head elements, agent css cascading BEFORE the author's
    // head styles. GREEN post-fix: exactly one head element, author styles before
    // agent css.
    it("produces exactly one head element with author styles before agent css (uppercase head with css)", async () => {
      const authorStyle = ".author{color:blue}";
      const agentCss = ".agent{color:red}";
      renderRenderer({
        html: [`<HEAD><style>${authorStyle}</style></HEAD><body>x</body>`],
        htmlComplete: true,
        css: agentCss,
        cssComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();
      // Exactly one head-open token (no duplicate head was prepended). Match is
      // quote-aware, mirroring the renderer's normalization regex.
      const headOpenings =
        frameContent.match(/<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi) ?? [];
      expect(headOpenings).toHaveLength(1);
      // Cascade: author head style precedes the agent css.
      const authorIdx = frameContent.indexOf(authorStyle);
      const agentIdx = frameContent.indexOf(agentCss);
      expect(authorIdx).toBeGreaterThan(-1);
      expect(agentIdx).toBeGreaterThan(-1);
      expect(authorIdx).toBeLessThan(agentIdx);
    });

    // Case 4 — stray </head> BEFORE the real head, WITH css. A global
    // `search(/<\/head>/i)` resolves to the FIRST close anywhere — here the
    // stray one before the real `<head>` — so the agent css splices outside and
    // before the real head (cascade inversion). React's assembleDocument scopes
    // the close search to at/after the matched head-open. GREEN post-fix: the
    // css lands INSIDE the real head, after the author's head content, before
    // the real `</head>`.
    it("anchors the css to the real head when a stray </head> precedes it", async () => {
      const agentCss = ".agent{color:red}";
      renderRenderer({
        html: ["foo</head><head><title>t</title></head><body>x</body>"],
        htmlComplete: true,
        css: agentCss,
        cssComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();

      // The css must sit inside the REAL head: after the head-open, after the
      // author's <title>, and before the real (last) </head>.
      const headOpenIdx = frameContent.indexOf("<head>");
      const titleIdx = frameContent.indexOf("<title>t</title>");
      const cssIdx = frameContent.indexOf(agentCss);
      const realHeadCloseIdx = frameContent
        .toLowerCase()
        .lastIndexOf("</head>");
      expect(headOpenIdx).toBeGreaterThan(-1);
      expect(titleIdx).toBeGreaterThan(-1);
      expect(cssIdx).toBeGreaterThan(-1);
      // Inside the real head, after the author content, before the real close.
      expect(cssIdx).toBeGreaterThan(headOpenIdx);
      expect(cssIdx).toBeGreaterThan(titleIdx);
      expect(cssIdx).toBeLessThan(realHeadCloseIdx);
    });

    // Case 5 — head-open with NO close AND NO `<body>`, WITH css (the final
    // fallback). ensureHead normalizes the open token; injectCssIntoHtml then
    // finds no `</head>` and no `<body>` and (pre-fix) PREPENDED a fresh
    // `<head><style>…</style></head>`, producing TWO head elements with the agent
    // css before the author's head content. GREEN post-fix: exactly ONE `<head`
    // token, css inserted immediately after the open (no `<body>` exists to
    // anchor the implicit-close branch — see the unclosed-head-with-body test
    // below for that path). React's assembleDocument non-legacy fallback inserts
    // after the head-open here too.
    it("inserts css after the head-open (one head) when no close and no body exist", async () => {
      const agentCss = ".agent{color:red}";
      renderRenderer({
        html: ["<HEAD><title>t</title>"],
        htmlComplete: true,
        css: agentCss,
        cssComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();

      // Exactly one head-open token — no duplicate head was prepended. Match is
      // quote-aware, mirroring the renderer's normalization regex.
      const headOpenings =
        frameContent.match(/<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi) ?? [];
      expect(headOpenings).toHaveLength(1);
      // The css sits after the (normalized) head-open and before the author's
      // <title>, i.e. immediately after the open rather than in a prepended head.
      const headOpenIdx = frameContent.indexOf("<head>");
      const cssIdx = frameContent.indexOf(agentCss);
      const titleIdx = frameContent.indexOf("<title>t</title>");
      expect(headOpenIdx).toBeGreaterThan(-1);
      expect(cssIdx).toBeGreaterThan(-1);
      expect(titleIdx).toBeGreaterThan(-1);
      expect(cssIdx).toBeGreaterThan(headOpenIdx);
      expect(cssIdx).toBeLessThan(titleIdx);
    });

    // ---------------------------------------------------------------------
    // Mask-before-match (Finding 1): the head helpers run their head-open
    // match and `</head>` close search on a length-preserving MASKED copy
    // (complete comments + style/script content blanked) and splice on the
    // ORIGINAL at the masked indices — mirroring react-core's assembleDocument
    // non-legacy anchoring. A `<head>`/`</head>` token inside a comment or
    // style/script content therefore can never capture the splice or
    // short-circuit normalization, and comments are preserved byte-for-byte.
    // ---------------------------------------------------------------------

    // Finding 1a — a `</head>` lookalike inside a comment BEFORE the real
    // close. RED pre-fix: injectCssIntoHtml searched the RAW html, so the
    // comment's `</head>` captured the close search and the agent css spliced
    // INSIDE the comment (inert — never applied). GREEN post-fix: the masked
    // search skips the comment's lookalike and the css lands inside the REAL
    // head, after the comment, before the real `</head>`.
    it("anchors css to the real </head>, not a </head> inside a comment (masked)", async () => {
      const agentCss = ".agent{color:red}";
      renderRenderer({
        html: ["<head><title>t</title><!-- </head> --></head><body>x</body>"],
        htmlComplete: true,
        css: agentCss,
        cssComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();

      const titleIdx = frameContent.indexOf("<title>t</title>");
      const commentIdx = frameContent.indexOf("<!-- </head> -->");
      const cssIdx = frameContent.indexOf(agentCss);
      const realCloseIdx = frameContent.toLowerCase().lastIndexOf("</head>");
      expect(titleIdx).toBeGreaterThan(-1);
      expect(commentIdx).toBeGreaterThan(-1);
      expect(cssIdx).toBeGreaterThan(-1);
      // The css lands AFTER the author content and AFTER the inert comment, and
      // BEFORE the real (last) </head> — i.e. inside the real head, not in the
      // comment.
      expect(cssIdx).toBeGreaterThan(titleIdx);
      expect(cssIdx).toBeGreaterThan(commentIdx);
      expect(cssIdx).toBeLessThan(realCloseIdx);
      // The comment (with its </head> lookalike) is preserved byte-for-byte.
      expect(frameContent).toContain("<!-- </head> -->");
    });

    // Finding 1b — a literal `<head>` inside a comment BEFORE the real
    // attributed head. RED pre-fix: ensureHead's RAW match found the comment's
    // `<head>` first and (token === "<head>") short-circuited, leaving the real
    // `<head lang="en">` un-normalized — so the only normalization websandbox's
    // `.replace('<head>', bootstrap)` could anchor on was the inert comment
    // token, and the real head never received the bootstrap (permanent spinner).
    // GREEN post-fix: the masked match skips the comment and normalizes the REAL
    // head to the literal `<head>`; the comment is preserved byte-for-byte.
    it("normalizes the real head, not a <head> inside a comment, keeping the comment intact (masked)", async () => {
      renderRenderer({
        html: [
          '<!-- <head> --><head lang="en"><title>t</title></head><body>x</body>',
        ],
        htmlComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();

      // websandbox's literal-head gate is satisfied.
      expect(frameContent).toContain("<head>");
      // The comment is preserved byte-for-byte (its inner <head> lookalike was
      // never rewritten).
      expect(frameContent).toContain("<!-- <head> -->");
      // The REAL head (past the comment close) was normalized: no attributed
      // head-open token survives there. Scoped past the comment so the
      // comment's own literal `<head>` is not counted, and this input has no
      // `<header>` to false-positive the broad attributed-head match.
      const commentClose = frameContent.indexOf("-->");
      expect(commentClose).toBeGreaterThan(-1);
      expect(frameContent.slice(commentClose)).not.toMatch(/<head[^>]+>/);
      expect(frameContent).not.toContain('lang="en"');
      // The author's head content survives.
      expect(frameContent).toContain("<title>t</title>");
    });

    // Finding 1c — a comment containing an attributed head lookalike BEFORE the
    // real attributed head. RED pre-fix: ensureHead's RAW match landed on the
    // comment's `<head lang="en">` and REWROTE that token to `<head>` (corrupting
    // the comment), while the real `<head lang="fr">` was left untouched. GREEN
    // post-fix: the masked match skips the comment (preserved byte-for-byte) and
    // normalizes the REAL head.
    it("rewrites the real head, not an attributed <head> inside a comment (masked)", async () => {
      renderRenderer({
        html: [
          '<!-- example: <head lang="en"> --><head lang="fr"><title>t</title></head><body>x</body>',
        ],
        htmlComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();

      // The comment is preserved byte-for-byte (its attributed head lookalike was
      // never rewritten).
      expect(frameContent).toContain('<!-- example: <head lang="en"> -->');
      // websandbox's literal token is present and the real head was normalized:
      // neither attribute string survives.
      expect(frameContent).toContain("<head>");
      expect(frameContent).not.toContain('lang="fr"');
      // The author's head content survives.
      expect(frameContent).toContain("<title>t</title>");
    });

    // Finding 2 — an UNCLOSED head WITH css and an in-head author style. RED
    // pre-fix: with no `</head>`, injectCssIntoHtml inserted the agent css
    // immediately after the head-open — BEFORE the author's in-head `<style>`,
    // inverting the author-first/css-last cascade (and flipping order against the
    // streaming preview, whose analyzeRegions implicitly closes the head at
    // `<body>`). GREEN post-fix: the first `<body>` after the head-open is the
    // implicit head close, so the css is inserted JUST BEFORE `<body>` — after
    // the author style, before the body.
    it("anchors css to the implicit <body> close for an unclosed head (author style before agent css)", async () => {
      const authorStyle = ".a{color:blue}";
      const agentCss = ".agent{color:red}";
      renderRenderer({
        html: [`<head><style>${authorStyle}</style><body>x</body>`],
        htmlComplete: true,
        css: agentCss,
        cssComplete: true,
      });
      await flushImport();
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const frameContent = finalFrameContent();

      // Exactly one head-open token — no duplicate head was synthesized.
      const headOpenings =
        frameContent.match(/<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi) ?? [];
      expect(headOpenings).toHaveLength(1);

      const authorIdx = frameContent.indexOf(authorStyle);
      const agentIdx = frameContent.indexOf(agentCss);
      const bodyIdx = frameContent.search(/<body[\s>]/i);
      expect(authorIdx).toBeGreaterThan(-1);
      expect(agentIdx).toBeGreaterThan(-1);
      expect(bodyIdx).toBeGreaterThan(-1);
      // Cascade parity: author in-head style FIRST, then the agent css, and the
      // agent css sits before the implicit `<body>` close.
      expect(authorIdx).toBeLessThan(agentIdx);
      expect(agentIdx).toBeLessThan(bodyIdx);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool renderer placeholder-message timer lifecycle.
//
// While the call is in progress and placeholderMessages exist, a 5s interval
// cycles the visible message. When the call completes the renderer returns
// null, but the interval keeps firing until unmount unless it is cleared on
// completion. React's equivalent keys its effect on props.status and clears
// the interval when status === Complete. The Vue watcher must do the same:
// include status in the watch source and clear the interval on completion.
// ---------------------------------------------------------------------------
describe("OpenGenerativeUIToolRenderer placeholder timer", () => {
  function renderTool(props: {
    status: ToolCallStatus;
    placeholderMessages?: string[];
    result?: string;
  }) {
    return render(OpenGenerativeUIToolRenderer, {
      props: {
        name: "generateSandboxedUi",
        args: { placeholderMessages: props.placeholderMessages },
        status: props.status,
        result: props.result,
      },
    });
  }

  // The placeholderMessages array is referentially STABLE across rerenders, so
  // the only thing that changes between in-progress and complete is `status`.
  // Pre-fix the watch source is `() => props.args.placeholderMessages` only, so
  // flipping status (same array ref) does NOT re-run the watcher and the
  // interval is never cleared — it keeps ticking until unmount. Post-fix the
  // watch source includes status, so completion re-runs the watcher, clears the
  // interval, and (being complete) does not re-arm.
  //
  // RED pre-fix: the captured interval callback still fires after completion
  // (the timer was never cleared). GREEN post-fix: it is cleared, so it never
  // fires again.
  it("clears the placeholder interval when the call completes", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const realSetInterval = window.setInterval.bind(window);
    const setSpy = vi.spyOn(window, "setInterval").mockImplementation(((
      cb: TimerHandler,
      ms?: number,
    ) => {
      // Wrap the renderer's callback so we can count actual ticks while still
      // arming a real fake-timers interval that advanceTimersByTime drives.
      const wrapped = () => {
        ticks += 1;
        if (typeof cb === "function") (cb as () => void)();
      };
      return realSetInterval(wrapped, ms);
    }) as typeof window.setInterval);

    const messages = ["First", "Second", "Third"];
    const mounted = renderTool({
      status: ToolCallStatus.Executing,
      placeholderMessages: messages,
    });

    // A 5s interval is armed while in progress.
    expect(setSpy).toHaveBeenCalledTimes(1);

    // While in progress, the interval fires on each 5s tick.
    vi.advanceTimersByTime(5000);
    expect(ticks).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(ticks).toBe(2);

    // The call completes — SAME placeholderMessages reference, only status
    // changes. The renderer returns null AND the interval must be cleared.
    const clearSpy = vi.spyOn(window, "clearInterval");
    await mounted.rerender({
      name: "generateSandboxedUi",
      args: { placeholderMessages: messages },
      status: ToolCallStatus.Complete,
      result: "done",
    });
    // The interval was cleared on completion (without unmounting).
    expect(clearSpy).toHaveBeenCalled();
    // No new interval was armed for the completed call.
    expect(setSpy).toHaveBeenCalledTimes(1);

    // Advancing well past several tick windows must produce NO further ticks —
    // proving the timer is gone rather than merely producing no visible output.
    const ticksAtCompletion = ticks;
    vi.advanceTimersByTime(20000);
    expect(ticks).toBe(ticksAtCompletion);

    mounted.unmount();
  });
});
