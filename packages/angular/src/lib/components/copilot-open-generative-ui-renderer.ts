import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { CopilotKit } from "../copilotkit";
import {
  extractCompleteStyles,
  processPartialHtml,
} from "../process-partial-html";
import type { OpenGenerativeUIContent } from "../sandbox-functions";

const THROTTLE_MS = 1000;

interface SandboxInstance {
  run: (code: string | Function) => Promise<unknown>;
  destroy: () => void;
  iframe: HTMLIFrameElement;
  promise: Promise<unknown>;
}

/**
 * Returns true when the renderer should flush content immediately rather
 * than waiting for the throttle window. Mirrors React's
 * `shouldFlushImmediately` heuristics so the streaming UX matches across
 * SDKs.
 */
function shouldFlushImmediately(
  prev: OpenGenerativeUIContent | null,
  next: OpenGenerativeUIContent,
): boolean {
  if (next.cssComplete && (!prev || !prev.cssComplete)) return true;
  if (next.htmlComplete) return true;
  if (next.generating === false) return true;
  if (next.jsFunctions && (!prev || !prev.jsFunctions)) return true;
  if ((next.jsExpressions?.length ?? 0) > (prev?.jsExpressions?.length ?? 0))
    return true;
  if (next.html?.length && (!prev || !prev.html?.length)) return true;
  return false;
}

function ensureHead(html: string): string {
  if (/<head[\s>]/i.test(html)) return html;
  return `<head></head>${html}`;
}

function injectCssIntoHtml(html: string, css: string): string {
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx !== -1) {
    return (
      html.slice(0, headCloseIdx) +
      `<style>${css}</style>` +
      html.slice(headCloseIdx)
    );
  }
  return `<head><style>${css}</style></head>${html}`;
}

/**
 * Activity renderer for `OpenGenerativeUIActivityType` messages — mounts a
 * sandboxed iframe via `@jetbrains/websandbox`, streams generated CSS/HTML
 * into it, executes `jsFunctions` and `jsExpressions`, and bridges
 * sandbox functions registered on `CopilotKit` into the iframe's
 * `Websandbox.connection.remote.<fn>` API.
 *
 * Mirrors React's `OpenGenerativeUIActivityRenderer` including the
 * throttle-with-immediate-flush content updates and auto-height
 * measurement on generation complete.
 */
@Component({
  selector: "copilot-open-generative-ui-renderer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #container
      data-slot="open-generative-ui-renderer"
      [style.position]="'relative'"
      [style.width.%]="100"
      [style.height.px]="height()"
      [style.borderRadius.px]="8"
      [style.backgroundColor]="
        hasVisibleSandbox() ? 'transparent' : '#f5f5f5'
      "
      [style.border]="hasVisibleSandbox() ? 'none' : '1px solid #e0e0e0'"
      [style.display]="hasVisibleSandbox() ? 'block' : 'flex'"
      [style.alignItems]="hasVisibleSandbox() ? null : 'center'"
      [style.justifyContent]="hasVisibleSandbox() ? null : 'center'"
      [style.overflow]="'hidden'"
    >
      @if (isGenerating()) {
        <div
          style="position: absolute; inset: 0; z-index: 10; pointer-events: all; background-color: rgba(255, 255, 255, 0.5); display: flex; align-items: center; justify-content: center;"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            style="animation: ck-spin 1s linear infinite;"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="#e0e0e0"
              stroke-width="3"
            />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="#999"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
          <style>
            @keyframes ck-spin {
              to {
                transform: rotate(360deg);
              }
            }
          </style>
        </div>
      }
    </div>
  `,
})
export class CopilotOpenGenerativeUIRenderer {
  readonly content = input.required<OpenGenerativeUIContent>();

  private readonly copilotkit = inject(CopilotKit);
  private readonly destroyRef = inject(DestroyRef);
  private readonly containerRef =
    viewChild.required<ElementRef<HTMLDivElement>>("container");

  // Throttled content — every render of this component sees the input
  // signal change, but the sandbox effects key off this signal so they
  // only react at most once per THROTTLE_MS window (with synchronous
  // flushes on milestone transitions).
  private readonly throttled = signal<OpenGenerativeUIContent | null>(null);
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private prevThrottled: OpenGenerativeUIContent | null = null;

  // localApi exposed to the sandbox iframe — recomputed when sandbox
  // functions change. Each function's `handler` is exposed verbatim.
  private readonly localApi = computed<Record<string, Function>>(() => {
    const fns = this.copilotkit.sandboxFunctions();
    const api: Record<string, Function> = {};
    for (const fn of fns) {
      api[fn.name] = fn.handler;
    }
    return api;
  });

  // Computed views over throttled content
  private readonly view = computed(() => {
    const c = this.throttled();
    if (!c) return null;
    const fullHtml =
      c.htmlComplete && c.html?.length ? c.html.join("") : undefined;
    const css = c.cssComplete ? c.css : undefined;
    const cssReady = !!c.cssComplete;
    const partialHtml =
      !c.htmlComplete && c.html?.length ? c.html.join("") : undefined;
    const previewBody = partialHtml
      ? processPartialHtml(partialHtml)
      : undefined;
    const previewStyles = partialHtml ? extractCompleteStyles(partialHtml) : "";
    const hasPreview = cssReady && !!previewBody?.trim();
    return {
      content: c,
      fullHtml,
      css,
      partialHtml,
      previewBody,
      previewStyles,
      hasPreview,
      hasVisibleSandbox: !!fullHtml || hasPreview,
    };
  });

  readonly hasVisibleSandbox = computed(
    () => this.view()?.hasVisibleSandbox ?? false,
  );
  readonly isGenerating = computed(
    () => (this.throttled()?.generating ?? true) !== false,
  );

  private readonly autoHeight = signal<number | null>(null);
  readonly height = computed(
    () => this.autoHeight() ?? this.throttled()?.initialHeight ?? 200,
  );

  // Sandbox lifecycle state
  private sandboxRef: SandboxInstance | null = null;
  private previewSandboxRef: SandboxInstance | null = null;
  private previewReady = false;
  private sandboxReady = false;
  private executedExpressionIndex = 0;
  private pendingQueue: string[] = [];
  private jsFunctionsInjected = false;
  private finalCancelled = false;
  private previewCancelled = false;
  private currentFinalKey: string | null = null;
  private currentPreviewKey: string | null = null;
  private currentFullHtml: string | undefined = undefined;
  private heightMessageHandler: ((e: MessageEvent) => void) | null = null;

  constructor() {
    // Throttle effect — mirrors React's render-time synchronous flush plus
    // the post-render scheduled flush.
    effect(
      () => {
        const next = this.content();
        if (
          this.prevThrottled !== null &&
          this.prevThrottled === next &&
          this.throttled() === next
        ) {
          return;
        }
        if (shouldFlushImmediately(this.prevThrottled, next)) {
          if (this.throttleTimer !== null) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
          }
          this.prevThrottled = next;
          this.throttled.set(next);
          return;
        }
        if (this.throttleTimer === null) {
          this.throttleTimer = setTimeout(() => {
            this.throttleTimer = null;
            const latest = this.content();
            this.prevThrottled = latest;
            this.throttled.set(latest);
          }, THROTTLE_MS);
        }
      },
      { allowSignalWrites: true },
    );

    // Preview sandbox lifecycle — mounts when hasPreview becomes true and
    // no fullHtml is ready yet. Updates body / styles as preview content
    // streams in.
    effect(() => {
      const v = this.view();
      const container = this.containerRef().nativeElement;
      if (!v || v.fullHtml || !v.hasPreview) {
        return;
      }
      const key = `${v.previewStyles?.length ?? 0}-${v.previewBody?.length ?? 0}-${v.css ?? ""}`;
      if (
        this.previewSandboxRef &&
        this.previewReady &&
        this.currentPreviewKey === key
      ) {
        return;
      }

      if (!this.previewSandboxRef) {
        this.mountPreviewSandbox(container, v.css, v.previewStyles, v.previewBody);
        this.currentPreviewKey = key;
      } else if (this.previewReady) {
        this.applyPreviewContent(v.css, v.previewStyles, v.previewBody);
        this.currentPreviewKey = key;
      }
    });

    // Final sandbox lifecycle — mounts once fullHtml is ready. Tears down
    // any preview sandbox before mounting.
    effect(() => {
      const v = this.view();
      const container = this.containerRef().nativeElement;
      if (!v || !v.fullHtml) return;

      const api = this.localApi();
      const key = `${v.fullHtml}::${v.css ?? ""}::${Object.keys(api).sort().join(",")}`;
      if (this.sandboxRef && this.currentFinalKey === key) return;

      this.teardownPreviewSandbox();
      this.teardownFinalSandbox();
      this.currentFinalKey = key;
      this.currentFullHtml = v.fullHtml;
      this.mountFinalSandbox(container, v.fullHtml, v.css, api);
    });

    // jsFunctions injection — runs once per fullHtml mount.
    effect(() => {
      const c = this.throttled();
      if (!c?.jsFunctions || this.jsFunctionsInjected) return;
      this.jsFunctionsInjected = true;
      this.runOrQueue(c.jsFunctions);
    });

    // jsExpressions execution — appends new expressions as they arrive.
    effect(() => {
      const c = this.throttled();
      const expressions = c?.jsExpressions;
      if (!expressions || expressions.length === 0) return;
      const startIndex = this.executedExpressionIndex;
      if (startIndex >= expressions.length) return;
      const newExprs = expressions.slice(startIndex);
      this.executedExpressionIndex = expressions.length;
      const sandbox = this.sandboxRef;
      if (this.sandboxReady && sandbox) {
        void (async () => {
          for (const expr of newExprs) {
            await sandbox.run(expr);
          }
        })();
      } else {
        this.pendingQueue.push(...newExprs);
      }
    });

    // One-shot height measurement when generation completes.
    effect(() => {
      const c = this.throttled();
      const sandbox = this.sandboxRef;
      if (!c || c.generating !== false || !sandbox) return;
      this.scheduleHeightMeasurement(sandbox);
    });

    this.destroyRef.onDestroy(() => {
      if (this.throttleTimer !== null) {
        clearTimeout(this.throttleTimer);
        this.throttleTimer = null;
      }
      if (this.heightMessageHandler) {
        window.removeEventListener("message", this.heightMessageHandler);
        this.heightMessageHandler = null;
      }
      this.teardownPreviewSandbox();
      this.teardownFinalSandbox();
    });
  }

  private mountPreviewSandbox(
    container: HTMLDivElement,
    css: string | undefined,
    previewStyles: string,
    previewBody: string | undefined,
  ): void {
    this.previewCancelled = false;
    void import("@jetbrains/websandbox")
      .then((mod: { default: { default?: unknown } | unknown }) => {
        if (this.previewCancelled) return;
        const Websandbox = (
          mod as { default: { default?: { create: Function } | Function } }
        ).default as { create?: Function; default?: { create: Function } };
        const Cls =
          (Websandbox as { default?: { create: Function } }).default ??
          (Websandbox as { create: Function });
        const sandbox = (Cls as { create: Function }).create(
          {},
          {
            frameContainer: container,
            frameContent: "<head></head><body></body>",
            allowAdditionalAttributes: "",
          },
        ) as SandboxInstance;
        this.previewSandboxRef = sandbox;

        sandbox.iframe.style.width = "100%";
        sandbox.iframe.style.height = "100%";
        sandbox.iframe.style.border = "none";
        sandbox.iframe.style.backgroundColor = "transparent";

        void sandbox.promise.then(() => {
          if (this.previewCancelled) return;
          this.previewReady = true;
          void sandbox.run(`
            var s = document.createElement('style');
            s.textContent = 'html, body { overflow: hidden !important; }';
            document.head.appendChild(s);
          `);
          this.applyPreviewContent(css, previewStyles, previewBody);
        });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          "[OpenGenerativeUI] Failed to load sandbox module:",
          err,
        );
      });
  }

  private applyPreviewContent(
    css: string | undefined,
    previewStyles: string,
    previewBody: string | undefined,
  ): void {
    const sandbox = this.previewSandboxRef;
    if (!sandbox || !this.previewReady) return;
    const headParts: string[] = [];
    if (css) headParts.push(`<style>${css}</style>`);
    if (previewStyles) headParts.push(previewStyles);
    if (headParts.length) {
      void sandbox.run(
        `document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`,
      );
    }
    if (!previewBody) return;
    void sandbox.run(
      `document.body.innerHTML = ${JSON.stringify(previewBody)}`,
    );
  }

  private mountFinalSandbox(
    container: HTMLDivElement,
    fullHtml: string,
    css: string | undefined,
    localApi: Record<string, Function>,
  ): void {
    this.finalCancelled = false;
    this.executedExpressionIndex = 0;
    this.jsFunctionsInjected = false;
    this.sandboxReady = false;
    this.pendingQueue = [];
    const htmlContent = css ? injectCssIntoHtml(fullHtml, css) : fullHtml;

    void import("@jetbrains/websandbox")
      .then((mod: { default: { default?: unknown } | unknown }) => {
        if (this.finalCancelled) return;
        const Websandbox = (
          mod as { default: { default?: { create: Function } | Function } }
        ).default as { create?: Function; default?: { create: Function } };
        const Cls =
          (Websandbox as { default?: { create: Function } }).default ??
          (Websandbox as { create: Function });
        const sandbox = (Cls as { create: Function }).create(localApi, {
          frameContainer: container,
          frameContent: ensureHead(htmlContent),
          allowAdditionalAttributes: "",
        }) as SandboxInstance;
        this.sandboxRef = sandbox;

        sandbox.iframe.style.width = "100%";
        sandbox.iframe.style.height = "100%";
        sandbox.iframe.style.border = "none";
        sandbox.iframe.style.backgroundColor = "transparent";

        void sandbox.promise.then(() => {
          if (this.finalCancelled) return;
          this.sandboxReady = true;
          void sandbox.run(`
            var s = document.createElement('style');
            s.textContent = 'html, body { overflow: hidden !important; }';
            document.head.appendChild(s);
          `);
          const queue = this.pendingQueue;
          this.pendingQueue = [];
          for (const code of queue) {
            void sandbox.run(code);
          }
        });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          "[OpenGenerativeUI] Failed to load sandbox module:",
          err,
        );
      });
  }

  private runOrQueue(code: string): void {
    const sandbox = this.sandboxRef;
    if (this.sandboxReady && sandbox) {
      void sandbox.run(code);
    } else {
      this.pendingQueue.push(code);
    }
  }

  private scheduleHeightMeasurement(sandbox: SandboxInstance): void {
    if (this.heightMessageHandler) return;
    let handled = false;
    const onMessage = (e: MessageEvent): void => {
      if (handled) return;
      if (
        e.source === sandbox.iframe.contentWindow &&
        (e.data as { type?: string } | undefined)?.type === "__ck_resize"
      ) {
        handled = true;
        const data = e.data as { height: number };
        this.autoHeight.set(data.height);
        if (this.heightMessageHandler) {
          window.removeEventListener("message", this.heightMessageHandler);
          this.heightMessageHandler = null;
        }
      }
    };
    this.heightMessageHandler = onMessage;
    window.addEventListener("message", onMessage);

    const measureOnce = `
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
    this.runOrQueue(measureOnce);
  }

  private teardownPreviewSandbox(): void {
    this.previewCancelled = true;
    if (this.previewSandboxRef) {
      try {
        this.previewSandboxRef.destroy();
      } catch {
        // ignore — sandbox may already be torn down by browser
      }
      this.previewSandboxRef = null;
      this.previewReady = false;
      this.currentPreviewKey = null;
    }
  }

  private teardownFinalSandbox(): void {
    this.finalCancelled = true;
    if (this.sandboxRef) {
      try {
        this.sandboxRef.destroy();
      } catch {
        // ignore
      }
      this.sandboxRef = null;
      this.sandboxReady = false;
      this.currentFinalKey = null;
      this.currentFullHtml = undefined;
      this.executedExpressionIndex = 0;
      this.jsFunctionsInjected = false;
      this.pendingQueue = [];
      this.autoHeight.set(null);
    }
  }
}
