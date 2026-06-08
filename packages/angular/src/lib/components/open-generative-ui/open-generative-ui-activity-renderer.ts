import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  InjectionToken,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import type { API } from "@jetbrains/websandbox/dist/types";
import type { ActivityRenderer } from "../../activity-renderer";
import type { OpenGenerativeUIContent } from "../../open-generative-ui";
import { injectCopilotKitConfig } from "../../config";
import {
  ensureHead,
  extractCompleteStyles,
  injectCssIntoHtml,
  processPartialHtml,
} from "./process-partial-html";
import {
  parseOpenGenerativeUIContent,
  resolveWebsandboxConstructor,
  shouldFlushOpenGenerativeUIImmediately,
  type WebsandboxConstructor,
  type WebsandboxInstance,
  type WebsandboxModuleShape,
} from "./open-generative-ui-renderer-utils";

export const OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER = new InjectionToken<
  () => Promise<WebsandboxConstructor>
>("OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER", {
  providedIn: "root",
  factory: () => async (): Promise<WebsandboxConstructor> => {
    const module =
      (await import("@jetbrains/websandbox")) as unknown as WebsandboxModuleShape;
    return resolveWebsandboxConstructor(module);
  },
});

const THROTTLE_MS = 1000;

type OpenGenerativeUIRenderState = {
  content: OpenGenerativeUIContent;
  fullHtml: string | undefined;
  css: string | undefined;
  hasPreview: boolean;
  previewBody: string | undefined;
  previewStyles: string;
  jsFunctions: string | undefined;
  jsExpressions: string[] | undefined;
  generatingDone: boolean;
};

@Component({
  selector: "copilot-open-generative-ui-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #container
      data-testid="open-generative-ui-renderer"
      class="copilot-open-generative-ui-container"
      [style.height.px]="height()"
      [class.has-visible-sandbox]="hasVisibleSandbox()"
    >
      @if (!hasVisibleSandbox() && isGenerating()) {
        <div
          data-testid="open-generative-ui-placeholder"
          class="copilot-open-generative-ui-placeholder"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            class="copilot-open-generative-ui-spinner"
          >
            <circle cx="12" cy="12" r="10" stroke="#e0e0e0" stroke-width="3" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="#999"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </div>
      }
      @if (hasVisibleSandbox() && isGenerating()) {
        <div
          data-testid="open-generative-ui-progress-overlay"
          class="copilot-open-generative-ui-overlay"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            class="copilot-open-generative-ui-spinner"
          >
            <circle cx="12" cy="12" r="10" stroke="#e0e0e0" stroke-width="3" />
            <path
              d="M12 2a10 10 0 0 1 10 10"
              stroke="#999"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .copilot-open-generative-ui-container {
        position: relative;
        width: 100%;
        border-radius: 8px;
        background-color: #f5f5f5;
        border: 1px solid #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .copilot-open-generative-ui-container.has-visible-sandbox {
        background-color: transparent;
        border: none;
        display: block;
      }

      .copilot-open-generative-ui-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .copilot-open-generative-ui-overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        pointer-events: all;
        background-color: rgba(255, 255, 255, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .copilot-open-generative-ui-spinner {
        animation: copilot-open-generative-ui-spin 1s linear infinite;
      }

      @keyframes copilot-open-generative-ui-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class CopilotOpenGenerativeUIRenderer {
  readonly content = input.required<OpenGenerativeUIContent>();

  private readonly containerRef = viewChild<
    unknown,
    ElementRef<HTMLDivElement>
  >("container", { read: ElementRef });
  private readonly destroyRef = inject(DestroyRef);
  private readonly config = injectCopilotKitConfig();
  private readonly loadWebsandboxModule = inject(
    OPEN_GENERATIVE_UI_WEBSANDBOX_LOADER,
  );
  private readonly throttledContent = signal<OpenGenerativeUIContent>({});
  private throttleTimer: ReturnType<typeof setTimeout> | undefined;
  private latestContent: OpenGenerativeUIContent = {};
  private sandbox: WebsandboxInstance | undefined;
  private previewSandbox: WebsandboxInstance | undefined;
  private sandboxReady = false;
  private previewReady = false;
  private finalSandboxKey: string | undefined;
  private executedExpressionIndex = 0;
  private pendingQueue: string[] = [];
  private jsFunctionsInjected = false;
  private heightMeasured = false;
  private autoHeight = signal<number | undefined>(undefined);
  private hasReceivedContent = false;

  protected readonly fullHtml = computed(() => {
    const content = this.throttledContent();
    return content.htmlComplete && content.html?.length
      ? content.html.join("")
      : undefined;
  });

  protected readonly css = computed(() => {
    const content = this.throttledContent();
    return content.cssComplete ? content.css : undefined;
  });

  protected readonly partialHtml = computed(() => {
    const content = this.throttledContent();
    return !content.htmlComplete && content.html?.length
      ? content.html.join("")
      : undefined;
  });

  protected readonly previewBody = computed(() => {
    const partialHtml = this.partialHtml();
    return partialHtml ? processPartialHtml(partialHtml) : undefined;
  });

  protected readonly previewStyles = computed(() => {
    const partialHtml = this.partialHtml();
    return partialHtml ? extractCompleteStyles(partialHtml) : "";
  });

  protected readonly hasPreview = computed(
    () => !!this.throttledContent().cssComplete && !!this.previewBody()?.trim(),
  );

  protected readonly hasVisibleSandbox = computed(
    () => !!this.fullHtml() || this.hasPreview(),
  );

  protected readonly height = computed(
    () => this.autoHeight() ?? this.throttledContent().initialHeight ?? 200,
  );

  protected readonly isGenerating = computed(
    () => this.throttledContent().generating !== false,
  );

  private readonly renderState = computed<OpenGenerativeUIRenderState>(() => {
    const content = this.throttledContent();
    return {
      content,
      fullHtml: this.fullHtml(),
      css: this.css(),
      hasPreview: this.hasPreview(),
      previewBody: this.previewBody(),
      previewStyles: this.previewStyles(),
      jsFunctions: content.jsFunctions,
      jsExpressions: content.jsExpressions,
      generatingDone: content.generating === false,
    };
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearThrottle();
      this.destroyPreviewSandbox();
      this.destroyFinalSandbox();
    });

    effect(() => {
      const next = parseOpenGenerativeUIContent(this.content());
      this.latestContent = next;
      const previous = untracked(() => this.throttledContent());

      if (!this.hasReceivedContent) {
        this.hasReceivedContent = true;
        this.clearThrottle();
        this.throttledContent.set(next);
        return;
      }

      if (shouldFlushOpenGenerativeUIImmediately(previous, next)) {
        this.clearThrottle();
        this.throttledContent.set(next);
        return;
      }

      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = undefined;
          this.throttledContent.set(this.latestContent);
        }, THROTTLE_MS);
      }
    });

    afterRenderEffect({
      write: () => {
        const state = this.renderState();
        this.containerRef();
        this.reconcileSandboxState(state);

        if (!state.generatingDone || this.heightMeasured || !this.sandbox) {
          return;
        }
        this.heightMeasured = true;
        const cleanup = this.measureFinalHeight();
        if (cleanup) this.destroyRef.onDestroy(cleanup);
      },
    });
  }

  private clearThrottle(): void {
    if (!this.throttleTimer) return;
    clearTimeout(this.throttleTimer);
    this.throttleTimer = undefined;
  }

  private async loadWebsandbox(): Promise<WebsandboxConstructor> {
    return this.loadWebsandboxModule();
  }

  private createLocalApi(): API {
    const api: API = {};
    for (const fn of this.config.openGenerativeUI?.sandboxFunctions ?? []) {
      api[fn.name] = fn.handler;
    }
    return api;
  }

  private createPreviewSandbox(state: OpenGenerativeUIRenderState): void {
    const container = this.containerRef()?.nativeElement;
    if (
      !container ||
      state.fullHtml ||
      !state.hasPreview ||
      this.previewSandbox
    ) {
      return;
    }

    void this.loadWebsandbox()
      .then((Websandbox) => {
        if (
          !this.containerRef() ||
          this.previewSandbox ||
          this.renderState().fullHtml
        ) {
          return;
        }

        const sandbox = Websandbox.create(
          {},
          {
            frameContainer: container,
            frameContent: "<head></head><body></body>",
            allowAdditionalAttributes: "",
          },
        );
        this.previewSandbox = sandbox;
        sandbox.iframe.setAttribute(
          "data-testid",
          "open-generative-ui-preview-sandbox",
        );
        this.styleIframe(sandbox.iframe);

        sandbox.promise.then(() => {
          if (this.previewSandbox !== sandbox) return;
          this.previewReady = true;
          void sandbox.run(`
            var s = document.createElement('style');
            s.textContent = 'html, body { overflow: hidden !important; }';
            document.head.appendChild(s);
          `);
          this.updatePreviewSandbox(this.renderState());
        });
      })
      .catch((error: unknown) => {
        console.error(
          "[OpenGenerativeUI] Failed to load sandbox module:",
          error,
        );
      });
  }

  private updatePreviewSandbox(state: OpenGenerativeUIRenderState): void {
    if (!this.previewSandbox || !this.previewReady) return;

    const headParts: string[] = [];
    if (state.css) headParts.push(`<style>${state.css}</style>`);
    if (state.previewStyles) headParts.push(state.previewStyles);
    if (headParts.length) {
      void this.previewSandbox.run(
        `document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`,
      );
    }
    if (state.previewBody) {
      void this.previewSandbox.run(
        `document.body.innerHTML = ${JSON.stringify(state.previewBody)}`,
      );
    }
  }

  private reconcileSandboxState(state: OpenGenerativeUIRenderState): void {
    if (!state.fullHtml) {
      this.destroyFinalSandbox();
      this.resetFinalRuntimeState();
      this.autoHeight.set(undefined);

      if (!state.hasPreview) {
        this.destroyPreviewSandbox();
        return;
      }

      this.createPreviewSandbox(state);
      this.updatePreviewSandbox(state);
      return;
    }

    this.destroyPreviewSandbox();
    const finalSandboxKey = this.getFinalSandboxKey(state.fullHtml, state.css);
    if (!this.sandbox || this.finalSandboxKey !== finalSandboxKey) {
      void this.createFinalSandbox(state.fullHtml, state.css, finalSandboxKey);
    }

    this.injectJsFunctions(state.jsFunctions);
    void this.executeNewExpressions(state.jsExpressions);
  }

  private getFinalSandboxKey(
    fullHtml: string,
    css: string | undefined,
  ): string {
    return JSON.stringify([fullHtml, css ?? ""]);
  }

  private async createFinalSandbox(
    fullHtml: string,
    css: string | undefined,
    finalSandboxKey: string,
  ): Promise<void> {
    const container = this.containerRef()?.nativeElement;
    if (!container || !fullHtml) return;

    this.destroyPreviewSandbox();
    this.destroyFinalSandbox();
    this.finalSandboxKey = finalSandboxKey;
    this.resetFinalRuntimeState();
    this.autoHeight.set(undefined);

    const htmlContent = css ? injectCssIntoHtml(fullHtml, css) : fullHtml;

    try {
      const Websandbox = await this.loadWebsandbox();
      if (!this.containerRef() || this.finalSandboxKey !== finalSandboxKey) {
        return;
      }

      const sandbox = Websandbox.create(this.createLocalApi(), {
        frameContainer: container,
        frameContent: ensureHead(htmlContent),
        allowAdditionalAttributes: "",
      });
      this.sandbox = sandbox;
      sandbox.iframe.setAttribute(
        "data-testid",
        "open-generative-ui-final-sandbox",
      );
      this.styleIframe(sandbox.iframe);

      sandbox.promise.then(() => {
        if (this.sandbox !== sandbox) return;
        this.sandboxReady = true;
        void sandbox.run(`
          var s = document.createElement('style');
          s.textContent = 'html, body { overflow: hidden !important; }';
          document.head.appendChild(s);
        `);
        const queue = this.pendingQueue;
        this.pendingQueue = [];
        for (const code of queue) void sandbox.run(code);
      });
    } catch (error) {
      if (this.finalSandboxKey === finalSandboxKey) {
        this.finalSandboxKey = undefined;
      }
      console.error("[OpenGenerativeUI] Failed to load sandbox module:", error);
    }
  }

  private resetFinalRuntimeState(): void {
    this.executedExpressionIndex = 0;
    this.jsFunctionsInjected = false;
    this.heightMeasured = false;
    this.pendingQueue = [];
    this.sandboxReady = false;
  }

  private injectJsFunctions(jsFunctions: string | undefined): void {
    if (!jsFunctions || this.jsFunctionsInjected) return;
    this.jsFunctionsInjected = true;
    this.runOrQueue(jsFunctions);
  }

  private async executeNewExpressions(
    expressions: string[] | undefined,
  ): Promise<void> {
    if (!expressions?.length) return;

    const startIndex = this.executedExpressionIndex;
    if (startIndex >= expressions.length) return;
    const newExpressions = expressions.slice(startIndex);
    this.executedExpressionIndex = expressions.length;

    if (this.sandboxReady && this.sandbox) {
      for (const expression of newExpressions) {
        await this.sandbox.run(expression);
      }
      return;
    }

    this.pendingQueue.push(...newExpressions);
  }

  private runOrQueue(code: string): void {
    if (this.sandboxReady && this.sandbox) {
      void this.sandbox.run(code);
      return;
    }
    this.pendingQueue.push(code);
  }

  private measureFinalHeight(): (() => void) | undefined {
    const sandbox = this.sandbox;
    if (!sandbox) return undefined;

    let handled = false;
    const onMessage = (event: MessageEvent) => {
      if (handled) return;
      if (
        event.source === sandbox.iframe.contentWindow &&
        event.data?.type === "__ck_resize"
      ) {
        handled = true;
        this.autoHeight.set(event.data.height);
        window.removeEventListener("message", onMessage);
      }
    };

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
    return () => window.removeEventListener("message", onMessage);
  }

  private styleIframe(iframe: HTMLIFrameElement): void {
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.backgroundColor = "transparent";
  }

  private destroyPreviewSandbox(): void {
    if (!this.previewSandbox) return;
    this.previewSandbox.destroy();
    this.previewSandbox = undefined;
    this.previewReady = false;
  }

  private destroyFinalSandbox(): void {
    if (this.sandbox) {
      this.sandbox.destroy();
      this.sandbox = undefined;
    }
    this.sandboxReady = false;
    this.heightMeasured = false;
    this.finalSandboxKey = undefined;
  }
}

@Component({
  selector: "copilot-open-generative-ui-activity-renderer",
  imports: [CopilotOpenGenerativeUIRenderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-open-generative-ui-renderer [content]="content()" />
  `,
})
export class CopilotOpenGenerativeUIActivityRenderer implements ActivityRenderer<OpenGenerativeUIContent> {
  readonly activityType = input.required<string>();
  readonly content = input.required<OpenGenerativeUIContent>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();
}
