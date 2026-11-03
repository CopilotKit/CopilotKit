import { shouldFlushImmediately } from "./content";
import type { OpenGenerativeUIContent } from "./content";
import {
  buildFinalFrameContent,
  extractCompleteStyles,
  processPartialHtml,
} from "./html";
import { loadWebsandbox } from "./websandbox";
import type {
  SandboxFunctionHandle,
  SandboxLocalApi,
  WebsandboxInstance,
  WebsandboxLoader,
} from "./websandbox";

/** Non-immediate content updates reach the sandbox at most this often. */
export const OPEN_GENERATIVE_UI_THROTTLE_MS = 1000;

const DEFAULT_HEIGHT = 200;

// Prevent scrollbars — the container auto-sizes to fit content
const HIDE_SCROLLBARS = `
  var s = document.createElement('style');
  s.textContent = 'html, body { overflow: hidden !important; }';
  document.head.appendChild(s);
`;
const HIDE_SCROLLBARS_STYLE =
  "<style>html, body { overflow: hidden !important; }</style>";

// Uses body.scrollHeight (not documentElement.scrollHeight) because the latter
// is clamped to the iframe viewport and can never shrink below the current size.
const MEASURE_HEIGHT = `
  (function() {
    var s = document.createElement('style');
    s.textContent = 'body { height: auto !important; min-height: 0 !important; }';
    document.head.appendChild(s);
    var h = document.body.scrollHeight;
    var cs = getComputedStyle(document.body);
    h += parseFloat(cs.marginTop) || 0;
    h += parseFloat(cs.marginBottom) || 0;
    s.remove();
    parent.postMessage({ type: "__ck_resize", height: Math.ceil(h) }, "*");
  })();
`;

/**
 * What the host element shows: a placeholder while nothing can render, a
 * preview while HTML streams, or the final sandbox.
 */
export type OpenGenerativeUIPhase = "placeholder" | "preview" | "final";

/** The state a framework renders around the host element. */
export interface OpenGenerativeUIState {
  phase: OpenGenerativeUIPhase;
  /** `true` until the agent reports `generating: false`. */
  generating: boolean;
  /** The measured height of the final UI, else `initialHeight`, else 200. */
  height: number;
}

export interface OpenGenerativeUIControllerOptions {
  /** Loads the websandbox class. Default: a dynamic `import()`. */
  loadWebsandbox?: WebsandboxLoader;
}

interface SandboxSlot {
  sandbox?: WebsandboxInstance;
  ready: boolean;
  cancelled: boolean;
}

interface PreviewSlot extends SandboxSlot {
  head?: string;
  body?: string;
}

interface FinalSlot extends SandboxSlot {
  frameContent: string;
  localApi: SandboxLocalApi;
  /** Code that waits for the sandbox to be ready. */
  queue: string[];
  jsFunctionsInjected: boolean;
  executedExpressions: number;
  heightRequested: boolean;
  stopHeightListener?: () => void;
}

interface DerivedContent {
  fullHtml?: string;
  css?: string;
  previewBody?: string;
  previewStyles: string;
}

function deriveContent(content: OpenGenerativeUIContent): DerivedContent {
  const html = content.html?.join("") || undefined;
  // CSS from the dedicated parameter, available once cssComplete
  const css = content.cssComplete ? content.css : undefined;
  if (content.htmlComplete) return { fullHtml: html, css, previewStyles: "" };
  // Gate the preview on cssComplete so the placeholder shows until styles are ready
  const previewBody =
    html && content.cssComplete ? processPartialHtml(html) : undefined;
  return {
    css,
    previewBody: previewBody?.trim() ? previewBody : undefined,
    previewStyles: html ? extractCompleteStyles(html) : "",
  };
}

function prepareIframe(iframe: HTMLIFrameElement, testId: string): void {
  iframe.setAttribute("data-testid", testId);
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.style.backgroundColor = "transparent";
}

function logLoadError(error: unknown): void {
  console.error("[OpenGenerativeUI] Failed to load sandbox module:", error);
}

function sameFunctions(
  a: readonly SandboxFunctionHandle[],
  b: readonly SandboxFunctionHandle[],
): boolean {
  return (
    a.length === b.length &&
    a.every((fn, i) => fn.name === b[i]!.name && fn.handler === b[i]!.handler)
  );
}

/**
 * Runs Open Generative UI content in websandbox iframes inside a host element.
 *
 * Give it content snapshots with `setContent()` and a host element with
 * `setHost()`. It throttles the snapshots, streams a preview while HTML
 * arrives, swaps in the final sandbox once HTML is complete, runs
 * `jsFunctions` and `jsExpressions` in it once each, and measures the final
 * height. Frameworks render the container from `getState()` and re-render
 * when `subscribe()` notifies.
 *
 * @example
 * ```ts
 * const controller = new ɵOpenGenerativeUIController();
 * controller.subscribe(() => render(controller.getState()));
 * controller.setContent(content);
 * controller.setHost(containerElement);
 * // On unmount:
 * controller.destroy();
 * ```
 */
export class OpenGenerativeUIController {
  readonly #load: WebsandboxLoader;
  readonly #listeners = new Set<() => void>();
  #content: OpenGenerativeUIContent | undefined;
  #latest: OpenGenerativeUIContent | undefined;
  #derived: DerivedContent = { previewStyles: "" };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #host: HTMLElement | null = null;
  #functions: readonly SandboxFunctionHandle[] = [];
  #localApi: SandboxLocalApi = {};
  #preview: PreviewSlot | undefined;
  #final: FinalSlot | undefined;
  #measuredHeight: number | undefined;
  #state: OpenGenerativeUIState = {
    phase: "placeholder",
    generating: true,
    height: DEFAULT_HEIGHT,
  };

  constructor(options: OpenGenerativeUIControllerOptions = {}) {
    this.#load = options.loadWebsandbox ?? loadWebsandbox;
  }

  /** The current state. The same object until something changes. */
  getState = (): OpenGenerativeUIState => this.#state;

  /** Calls `listener` when the state changes. Returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Sets the latest content snapshot. The first snapshot and snapshots that
   * finish a stage apply at once; others apply at most once per second.
   */
  setContent(content: OpenGenerativeUIContent): void {
    this.#latest = content;
    if (
      this.#content === undefined ||
      shouldFlushImmediately(this.#content, content)
    ) {
      this.#clearTimer();
      this.#commit(content);
      return;
    }
    if (content === this.#content || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#latest) this.#commit(this.#latest);
    }, OPEN_GENERATIVE_UI_THROTTLE_MS);
  }

  /** Sets the element the sandbox iframes go into. `null` removes them. */
  setHost(host: HTMLElement | null): void {
    if (host === this.#host) return;
    this.#destroyPreview();
    this.#destroyFinal();
    this.#host = host;
    this.#reconcile();
  }

  /**
   * Sets the host functions sandboxed code can call. A change recreates the
   * final sandbox.
   */
  setSandboxFunctions(functions: readonly SandboxFunctionHandle[]): void {
    if (sameFunctions(functions, this.#functions)) return;
    this.#functions = functions;
    const localApi: SandboxLocalApi = {};
    for (const fn of functions) localApi[fn.name] = fn.handler;
    this.#localApi = localApi;
    this.#reconcile();
  }

  /**
   * Removes the sandboxes and stops pending work. A later `setHost()`
   * starts again from the current content.
   */
  destroy(): void {
    this.#clearTimer();
    this.#destroyPreview();
    this.#destroyFinal();
    this.#host = null;
  }

  #commit(content: OpenGenerativeUIContent): void {
    if (content === this.#content) return;
    this.#content = content;
    this.#derived = deriveContent(content);
    this.#reconcile();
  }

  #reconcile(): void {
    const host = this.#host;
    const content = this.#content;
    const derived = this.#derived;
    if (host && content) {
      if (derived.fullHtml) {
        this.#destroyPreview();
        const frameContent = buildFinalFrameContent(
          derived.fullHtml,
          derived.css,
        );
        let final = this.#final;
        if (
          final?.frameContent !== frameContent ||
          final.localApi !== this.#localApi
        ) {
          this.#destroyFinal();
          final = this.#final = this.#createFinal(host, frameContent);
        }
        this.#runScripts(final, content);
      } else {
        this.#destroyFinal();
        if (derived.previewBody) {
          this.#preview ??= this.#createPreview(host);
          this.#writePreview();
        } else {
          this.#destroyPreview();
        }
      }
    }
    this.#updateState();
  }

  #createPreview(host: HTMLElement): PreviewSlot {
    const slot: PreviewSlot = { ready: false, cancelled: false };
    this.#load()
      .then((Websandbox) => {
        if (slot.cancelled) return;
        const sandbox = Websandbox.create(
          {},
          {
            frameContainer: host,
            frameContent: "<head></head><body></body>",
            allowAdditionalAttributes: "",
          },
        );
        slot.sandbox = sandbox;
        prepareIframe(sandbox.iframe, "open-generative-ui-preview-sandbox");
        sandbox.promise.then(() => {
          if (slot.cancelled) return;
          slot.ready = true;
          this.#writePreview();
        });
      })
      .catch(logLoadError);
    return slot;
  }

  #writePreview(): void {
    const slot = this.#preview;
    if (!slot?.sandbox || !slot.ready) return;
    const { css, previewStyles, previewBody } = this.#derived;
    // The scrollbar rule lives in the head so that replacing the head keeps it
    const head =
      HIDE_SCROLLBARS_STYLE +
      (css ? `<style>${css}</style>` : "") +
      previewStyles;
    if (head !== slot.head) {
      slot.head = head;
      void slot.sandbox.run(
        `document.head.innerHTML = ${JSON.stringify(head)}`,
      );
    }
    if (previewBody && previewBody !== slot.body) {
      slot.body = previewBody;
      void slot.sandbox.run(
        `document.body.innerHTML = ${JSON.stringify(previewBody)}`,
      );
    }
  }

  #createFinal(host: HTMLElement, frameContent: string): FinalSlot {
    const slot: FinalSlot = {
      frameContent,
      localApi: this.#localApi,
      ready: false,
      cancelled: false,
      queue: [],
      jsFunctionsInjected: false,
      executedExpressions: 0,
      heightRequested: false,
    };
    this.#load()
      .then((Websandbox) => {
        if (slot.cancelled) return;
        const sandbox = Websandbox.create(slot.localApi, {
          frameContainer: host,
          frameContent,
          allowAdditionalAttributes: "",
        });
        slot.sandbox = sandbox;
        prepareIframe(sandbox.iframe, "open-generative-ui-final-sandbox");
        sandbox.promise.then(() => {
          if (slot.cancelled) return;
          slot.ready = true;
          void sandbox.run(HIDE_SCROLLBARS);
          const queue = slot.queue;
          slot.queue = [];
          for (const code of queue) void sandbox.run(code);
        });
      })
      .catch(logLoadError);
    return slot;
  }

  /** Runs new `jsFunctions`, new `jsExpressions`, and the height measurement. */
  #runScripts(slot: FinalSlot, content: OpenGenerativeUIContent): void {
    if (content.jsFunctions && !slot.jsFunctionsInjected) {
      slot.jsFunctionsInjected = true;
      this.#runOrQueue(slot, content.jsFunctions);
    }

    const expressions = content.jsExpressions ?? [];
    if (expressions.length > slot.executedExpressions) {
      const newExpressions = expressions.slice(slot.executedExpressions);
      slot.executedExpressions = expressions.length;
      const sandbox = slot.sandbox;
      if (slot.ready && sandbox) {
        void (async () => {
          for (const expression of newExpressions) {
            await sandbox.run(expression);
          }
        })();
      } else {
        slot.queue.push(...newExpressions);
      }
    }

    // Measure once per sandbox, when generation completes
    if (content.generating === false && !slot.heightRequested) {
      slot.heightRequested = true;
      this.#listenForHeight(slot);
      this.#runOrQueue(slot, MEASURE_HEIGHT);
    }
  }

  #runOrQueue(slot: FinalSlot, code: string): void {
    if (slot.ready && slot.sandbox) {
      void slot.sandbox.run(code);
    } else {
      slot.queue.push(code);
    }
  }

  #listenForHeight(slot: FinalSlot): void {
    if (typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (
        !slot.sandbox ||
        event.source !== slot.sandbox.iframe.contentWindow ||
        data?.type !== "__ck_resize" ||
        typeof data.height !== "number"
      ) {
        return;
      }
      slot.stopHeightListener?.();
      this.#measuredHeight = data.height;
      this.#updateState();
    };
    window.addEventListener("message", onMessage);
    slot.stopHeightListener = () => {
      window.removeEventListener("message", onMessage);
      slot.stopHeightListener = undefined;
    };
  }

  #destroyPreview(): void {
    const slot = this.#preview;
    if (!slot) return;
    slot.cancelled = true;
    slot.sandbox?.destroy();
    this.#preview = undefined;
  }

  #destroyFinal(): void {
    const slot = this.#final;
    if (!slot) return;
    slot.cancelled = true;
    slot.stopHeightListener?.();
    slot.sandbox?.destroy();
    this.#final = undefined;
    this.#measuredHeight = undefined;
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #updateState(): void {
    const content = this.#content ?? {};
    const derived = this.#derived;
    const next: OpenGenerativeUIState = {
      phase: derived.fullHtml
        ? "final"
        : derived.previewBody
          ? "preview"
          : "placeholder",
      generating: content.generating !== false,
      height: this.#measuredHeight ?? content.initialHeight ?? DEFAULT_HEIGHT,
    };
    const current = this.#state;
    if (
      next.phase === current.phase &&
      next.generating === current.generating &&
      next.height === current.height
    ) {
      return;
    }
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}
