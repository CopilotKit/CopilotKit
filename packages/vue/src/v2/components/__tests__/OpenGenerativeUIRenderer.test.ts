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
  });
});
