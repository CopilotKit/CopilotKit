import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_GENERATIVE_UI_THROTTLE_MS,
  OpenGenerativeUIController,
} from "../controller";
import type { OpenGenerativeUIContent } from "../content";
import type { SandboxLocalApi, WebsandboxConstructor } from "../websandbox";

interface FakeSandbox {
  localApi: SandboxLocalApi;
  frameContent: string;
  frameContainer: HTMLElement;
  iframe: HTMLIFrameElement;
  promise: Promise<unknown>;
  run: ReturnType<typeof vi.fn<(code: string) => Promise<unknown>>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  /** Resolves `promise`, as websandbox does once the iframe document loads. */
  becomeReady: () => void;
  /** The code passed to `run`, in call order. */
  ranCode: () => string[];
}

function createFakeWebsandbox() {
  const sandboxes: FakeSandbox[] = [];
  const Websandbox: WebsandboxConstructor = {
    create(localApi, options) {
      let becomeReady!: () => void;
      const run = vi.fn<(code: string) => Promise<unknown>>(async () => {});
      const sandbox: FakeSandbox = {
        localApi,
        frameContent: options.frameContent,
        frameContainer: options.frameContainer,
        iframe: {
          style: {},
          setAttribute: vi.fn(),
          contentWindow: {},
        } as unknown as HTMLIFrameElement,
        promise: new Promise<void>((resolve) => {
          becomeReady = resolve;
        }),
        run,
        destroy: vi.fn<() => void>(),
        becomeReady: () => becomeReady(),
        ranCode: () => run.mock.calls.map(([code]) => code),
      };
      sandboxes.push(sandbox);
      return sandbox;
    },
  };
  const load = vi.fn(async () => Websandbox);
  return { load, sandboxes };
}

function measureRuns(sandbox: FakeSandbox) {
  return sandbox.ranCode().filter((code) => code.includes("__ck_resize"))
    .length;
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const host = {} as HTMLElement;

const finalContent: OpenGenerativeUIContent = {
  css: ".app { color: red; }",
  cssComplete: true,
  html: ["<head></head>", "<body><div class='app'>Hi</div></body>"],
  htmlComplete: true,
};

const previewContent: OpenGenerativeUIContent = {
  css: ".app { color: red; }",
  cssComplete: true,
  html: ["<body><div class='app'>Hel"],
  generating: true,
};

describe("OpenGenerativeUIController", () => {
  let fake: ReturnType<typeof createFakeWebsandbox>;
  let controller: OpenGenerativeUIController;
  let messageTarget: EventTarget;

  beforeEach(() => {
    messageTarget = new EventTarget();
    vi.stubGlobal("window", messageTarget);
    fake = createFakeWebsandbox();
    controller = new OpenGenerativeUIController({ loadWebsandbox: fake.load });
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("state", () => {
    it("starts as a generating placeholder at the default height", () => {
      expect(controller.getState()).toEqual({
        phase: "placeholder",
        generating: true,
        height: 200,
      });
    });

    it("keeps the placeholder while HTML streams before the CSS completes", () => {
      controller.setContent({ html: ["<body><p>Hi"], initialHeight: 320 });
      expect(controller.getState()).toEqual({
        phase: "placeholder",
        generating: true,
        height: 320,
      });
    });

    it("keeps the placeholder when the streamed HTML has no body content yet", () => {
      controller.setContent({
        cssComplete: true,
        html: ["<head><style>.a{}</style></head>"],
      });
      expect(controller.getState().phase).toBe("placeholder");
    });

    it("moves to preview, then to final with generation done", () => {
      controller.setContent(previewContent);
      expect(controller.getState().phase).toBe("preview");

      controller.setContent({ ...finalContent, generating: false });
      expect(controller.getState()).toEqual({
        phase: "final",
        generating: false,
        height: 200,
      });
    });

    it("notifies subscribers on change and stops after unsubscribe", () => {
      const listener = vi.fn();
      const unsubscribe = controller.subscribe(listener);

      controller.setContent(previewContent);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      controller.setContent(finalContent);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("keeps the same state object when nothing visible changes", () => {
      controller.setContent({ initialHeight: 300 });
      const before = controller.getState();
      controller.setContent({ initialHeight: 300, generating: true });
      expect(controller.getState()).toBe(before);
    });
  });

  describe("throttling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("holds streamed chunks until the throttle window ends", () => {
      controller.setContent({ cssComplete: true, html: ["<p"] });
      const next: OpenGenerativeUIContent = {
        cssComplete: true,
        html: ["<p", ">Hello</p>"],
      };
      controller.setContent(next);
      expect(controller.getState().phase).toBe("placeholder");

      vi.advanceTimersByTime(OPEN_GENERATIVE_UI_THROTTLE_MS);
      expect(controller.getState().phase).toBe("preview");
    });

    it("applies the latest snapshot when the window ends", async () => {
      controller.setHost(host);
      controller.setContent(previewContent);
      await flushMicrotasks();
      const [preview] = fake.sandboxes;
      preview!.becomeReady();
      await flushMicrotasks();

      controller.setContent({
        ...previewContent,
        html: ["<body><div class='app'>Hello"],
      });
      controller.setContent({
        ...previewContent,
        html: ["<body><div class='app'>Hello world"],
      });
      vi.advanceTimersByTime(OPEN_GENERATIVE_UI_THROTTLE_MS);

      const bodyWrites = preview!
        .ranCode()
        .filter((code) => code.includes("document.body.innerHTML"));
      expect(bodyWrites).toHaveLength(2);
      expect(bodyWrites[1]).toContain("Hello world");
    });

    it("applies a completing snapshot at once and drops the pending one", () => {
      const listener = vi.fn();
      controller.setContent({ cssComplete: true, html: ["<p"] });
      controller.setContent({ cssComplete: true, html: ["<p", ">Hi"] });
      controller.subscribe(listener);

      controller.setContent(finalContent);
      expect(controller.getState().phase).toBe("final");

      vi.advanceTimersByTime(OPEN_GENERATIVE_UI_THROTTLE_MS);
      expect(controller.getState().phase).toBe("final");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("cancels a pending snapshot on destroy", () => {
      controller.setContent({ cssComplete: true, html: ["<p"] });
      controller.setContent({ cssComplete: true, html: ["<p", ">Hi"] });
      controller.destroy();

      vi.advanceTimersByTime(OPEN_GENERATIVE_UI_THROTTLE_MS);
      expect(controller.getState().phase).toBe("placeholder");
    });
  });

  describe("preview sandbox", () => {
    it("is created in the host with an empty document and no host functions", async () => {
      controller.setSandboxFunctions([{ name: "save", handler: vi.fn() }]);
      controller.setHost(host);
      controller.setContent(previewContent);
      await flushMicrotasks();

      expect(fake.sandboxes).toHaveLength(1);
      expect(fake.sandboxes[0]).toMatchObject({
        frameContainer: host,
        frameContent: "<head></head><body></body>",
        localApi: {},
      });
    });

    it("writes the CSS, inline styles, and processed body once ready", async () => {
      controller.setHost(host);
      controller.setContent({
        ...previewContent,
        html: ["<style>.x{}</style><body><div>Hel<span cl"],
      });
      await flushMicrotasks();
      const [preview] = fake.sandboxes;
      expect(preview!.run).not.toHaveBeenCalled();

      preview!.becomeReady();
      await flushMicrotasks();

      const [head, body] = preview!.ranCode();
      expect(head).toContain("document.head.innerHTML");
      expect(head).toContain("<style>.app { color: red; }</style>");
      expect(head).toContain("<style>.x{}</style>");
      expect(head).toContain("overflow: hidden");
      expect(body).toBe(
        `document.body.innerHTML = ${JSON.stringify("<div>Hel")}`,
      );
    });

    it("is not created when the content restarts before the loader resolves", async () => {
      controller.setHost(host);
      controller.setContent(previewContent);
      controller.setContent({ generating: true });
      await flushMicrotasks();

      expect(fake.load).toHaveBeenCalledTimes(1);
      expect(fake.sandboxes).toHaveLength(0);
    });

    it("is destroyed when the final HTML arrives", async () => {
      controller.setHost(host);
      controller.setContent(previewContent);
      await flushMicrotasks();

      controller.setContent(finalContent);
      await flushMicrotasks();

      const [preview, final] = fake.sandboxes;
      expect(preview!.destroy).toHaveBeenCalledTimes(1);
      expect(final!.frameContent).toContain("Hi");
    });
  });

  describe("final sandbox", () => {
    it("puts the CSS into the head and passes the host functions", async () => {
      const save = vi.fn();
      controller.setSandboxFunctions([{ name: "save", handler: save }]);
      controller.setHost(host);
      controller.setContent(finalContent);
      await flushMicrotasks();

      expect(fake.sandboxes).toHaveLength(1);
      expect(fake.sandboxes[0]).toMatchObject({
        frameContent:
          "<head><style>.app { color: red; }</style></head><body><div class='app'>Hi</div></body>",
        localApi: { save },
      });
    });

    it("waits for a host before creating a sandbox", async () => {
      controller.setContent(finalContent);
      await flushMicrotasks();
      expect(fake.load).not.toHaveBeenCalled();

      controller.setHost(host);
      await flushMicrotasks();
      expect(fake.sandboxes).toHaveLength(1);
    });

    it("queues jsFunctions and jsExpressions until ready, then runs them in order", async () => {
      controller.setHost(host);
      controller.setContent({
        ...finalContent,
        jsFunctions: "function init() {}",
        jsExpressions: ["init()", "paint()"],
      });
      await flushMicrotasks();
      const [final] = fake.sandboxes;
      expect(final!.run).not.toHaveBeenCalled();

      final!.becomeReady();
      await flushMicrotasks();

      expect(final!.ranCode().slice(1)).toEqual([
        "function init() {}",
        "init()",
        "paint()",
      ]);
    });

    it("runs only the new jsExpressions as the list grows", async () => {
      controller.setHost(host);
      controller.setContent({ ...finalContent, jsExpressions: ["one()"] });
      await flushMicrotasks();
      const [final] = fake.sandboxes;
      final!.becomeReady();
      await flushMicrotasks();

      controller.setContent({
        ...finalContent,
        jsExpressions: ["one()", "two()"],
      });
      await flushMicrotasks();

      const expressions = final!
        .ranCode()
        .filter((code) => code === "one()" || code === "two()");
      expect(expressions).toEqual(["one()", "two()"]);
      expect(fake.sandboxes).toHaveLength(1);
    });

    it("loads only once when equal content repeats while loading", async () => {
      controller.setHost(host);
      controller.setContent(finalContent);
      controller.setContent({ ...finalContent });
      await flushMicrotasks();

      expect(fake.load).toHaveBeenCalledTimes(1);
      expect(fake.sandboxes).toHaveLength(1);
    });

    it("creates only the latest sandbox when HTML changes A to B to A while loading", async () => {
      const contentA = { html: ["<body>A</body>"], htmlComplete: true };
      const contentB = { html: ["<body>B</body>"], htmlComplete: true };
      controller.setHost(host);
      controller.setContent(contentA);
      controller.setContent(contentB);
      controller.setContent({ ...contentA });
      await flushMicrotasks();

      expect(fake.load).toHaveBeenCalledTimes(3);
      expect(fake.sandboxes).toHaveLength(1);
      expect(fake.sandboxes[0]!.frameContent).toContain("A");
    });

    it("replaces the sandbox and reruns the scripts when the HTML changes", async () => {
      const scripts = {
        jsFunctions: "function f() {}",
        jsExpressions: ["f()"],
      };
      controller.setHost(host);
      controller.setContent({ ...finalContent, ...scripts });
      await flushMicrotasks();
      fake.sandboxes[0]!.becomeReady();
      await flushMicrotasks();

      controller.setContent({
        ...finalContent,
        ...scripts,
        html: ["<body>v2</body>"],
      });
      await flushMicrotasks();
      const [first, second] = fake.sandboxes;
      second!.becomeReady();
      await flushMicrotasks();

      expect(first!.destroy).toHaveBeenCalledTimes(1);
      expect(second!.frameContent).toContain("v2");
      expect(second!.ranCode().slice(1)).toEqual(["function f() {}", "f()"]);
    });

    it("replaces the sandbox when the host functions change, not when they repeat", async () => {
      const save = vi.fn();
      controller.setSandboxFunctions([{ name: "save", handler: save }]);
      controller.setHost(host);
      controller.setContent(finalContent);
      await flushMicrotasks();

      controller.setSandboxFunctions([{ name: "save", handler: save }]);
      await flushMicrotasks();
      expect(fake.sandboxes).toHaveLength(1);

      const load = vi.fn();
      controller.setSandboxFunctions([{ name: "load", handler: load }]);
      await flushMicrotasks();

      expect(fake.sandboxes).toHaveLength(2);
      expect(fake.sandboxes[0]!.destroy).toHaveBeenCalledTimes(1);
      expect(fake.sandboxes[1]!.localApi).toEqual({ load });
    });

    it("is destroyed at once when a new generation starts", async () => {
      controller.setHost(host);
      controller.setContent(finalContent);
      await flushMicrotasks();

      controller.setContent({ generating: true, initialHeight: 360 });

      expect(fake.sandboxes[0]!.destroy).toHaveBeenCalledTimes(1);
      expect(controller.getState()).toEqual({
        phase: "placeholder",
        generating: true,
        height: 360,
      });
    });

    it("is destroyed by destroy() and recreated by a later setHost()", async () => {
      controller.setHost(host);
      controller.setContent(finalContent);
      await flushMicrotasks();

      controller.destroy();
      expect(fake.sandboxes[0]!.destroy).toHaveBeenCalledTimes(1);

      controller.setHost(host);
      await flushMicrotasks();
      expect(fake.sandboxes).toHaveLength(2);
    });

    it("logs and stays empty when websandbox fails to load", async () => {
      const error = new Error("offline");
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      controller = new OpenGenerativeUIController({
        loadWebsandbox: () => Promise.reject(error),
      });
      controller.setHost(host);
      controller.setContent(finalContent);
      await flushMicrotasks();

      expect(consoleError).toHaveBeenCalledWith(
        "[OpenGenerativeUI] Failed to load sandbox module:",
        error,
      );
      consoleError.mockRestore();
    });
  });

  describe("height", () => {
    function postResize(source: unknown, height: unknown) {
      const event = Object.assign(new Event("message"), {
        source,
        data: { type: "__ck_resize", height },
      });
      messageTarget.dispatchEvent(event);
    }

    async function renderFinal(content: OpenGenerativeUIContent) {
      controller.setHost(host);
      controller.setContent(content);
      await flushMicrotasks();
      const final = fake.sandboxes.at(-1)!;
      final.becomeReady();
      await flushMicrotasks();
      return final;
    }

    it("measures once when generation completes", async () => {
      const final = await renderFinal({ ...finalContent, generating: true });
      expect(measureRuns(final)).toBe(0);

      controller.setContent({ ...finalContent, generating: false });
      controller.setContent({
        ...finalContent,
        generating: false,
        initialHeight: 321,
      });
      await flushMicrotasks();

      expect(measureRuns(final)).toBe(1);
    });

    it("measures when generation was already done before the sandbox was ready", async () => {
      const final = await renderFinal({ ...finalContent, generating: false });
      expect(measureRuns(final)).toBe(1);
    });

    it("uses the height the final sandbox reports", async () => {
      const final = await renderFinal({ ...finalContent, generating: false });

      postResize({}, 999);
      expect(controller.getState().height).toBe(200);

      postResize(final.iframe.contentWindow, 412);
      expect(controller.getState().height).toBe(412);

      postResize(final.iframe.contentWindow, 10);
      expect(controller.getState().height).toBe(412);
    });

    it("drops the measured height when the sandbox is replaced", async () => {
      const final = await renderFinal({ ...finalContent, generating: false });
      postResize(final.iframe.contentWindow, 412);

      controller.setContent({ generating: true, initialHeight: 150 });
      expect(controller.getState().height).toBe(150);
    });
  });
});
