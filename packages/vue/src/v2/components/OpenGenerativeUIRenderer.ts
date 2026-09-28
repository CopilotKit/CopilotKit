import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from "vue";
import type { PropType } from "vue";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import {
  processPartialHtml,
  extractCompleteStyles,
} from "../lib/processPartialHtml";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";

export const OpenGenerativeUIActivityType = "open-generative-ui";

export const OpenGenerativeUIContentSchema = z.object({
  initialHeight: z.number().optional(),
  generating: z.boolean().optional(),
  css: z.string().optional(),
  cssComplete: z.boolean().optional(),
  html: z.array(z.string()).optional(),
  htmlComplete: z.boolean().optional(),
  jsFunctions: z.string().optional(),
  jsFunctionsComplete: z.boolean().optional(),
  jsExpressions: z.array(z.string()).optional(),
  jsExpressionsComplete: z.boolean().optional(),
});

export type OpenGenerativeUIContent = z.infer<
  typeof OpenGenerativeUIContentSchema
>;

export const GenerateSandboxedUiArgsSchema = z.object({
  initialHeight: z.number().optional(),
  placeholderMessages: z.array(z.string()).optional(),
  css: z.string().optional(),
  html: z.string().optional(),
  jsFunctions: z.string().optional(),
  jsExpressions: z.array(z.string()).optional(),
});

export type GenerateSandboxedUiArgs = z.infer<
  typeof GenerateSandboxedUiArgsSchema
>;

function shouldFlushImmediately(
  previous: OpenGenerativeUIContent | null,
  next: OpenGenerativeUIContent,
): boolean {
  if (next.cssComplete && (!previous || !previous.cssComplete)) return true;
  if (next.htmlComplete) return true;
  if (next.generating === false) return true;
  if (next.jsFunctions && (!previous || !previous.jsFunctions)) return true;
  if (
    (next.jsExpressions?.length ?? 0) > (previous?.jsExpressions?.length ?? 0)
  )
    return true;
  if (next.html?.length && (!previous || !previous.html?.length)) return true;
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

type SandboxInstance = {
  iframe: HTMLIFrameElement;
  promise: Promise<unknown>;
  run: (code: string | Function) => Promise<unknown>;
  destroy: () => void;
};

type WebsandboxModule = {
  create: (
    localApi: Record<string, unknown>,
    options: {
      frameContainer: HTMLElement;
      frameContent: string;
      allowAdditionalAttributes: string;
    },
  ) => SandboxInstance;
};

/** Runs in the sandbox: posts the content's height back to the host once. */
const MEASURE_HEIGHT_ONCE = `
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

async function loadWebsandbox(): Promise<WebsandboxModule> {
  const mod = (await import("@jetbrains/websandbox")) as any;
  return (mod.default?.default ?? mod.default) as WebsandboxModule;
}

export const OpenGenerativeUIRenderer = defineComponent({
  name: "OpenGenerativeUIRenderer",
  props: {
    content: {
      type: Object as PropType<OpenGenerativeUIContent>,
      required: true,
    },
  },
  setup(props) {
    const sandboxFunctions = useSandboxFunctions();
    const containerRef = ref<HTMLElement | null>(null);
    const throttledContent = ref<OpenGenerativeUIContent>(props.content);
    const latestContent = ref<OpenGenerativeUIContent>(props.content);
    const throttleTimer = ref<number | null>(null);
    const sandboxRef = ref<SandboxInstance | null>(null);
    const previewSandboxRef = ref<SandboxInstance | null>(null);
    const sandboxReady = ref(false);
    const previewReady = ref(false);
    const executedExpressionIndex = ref(0);
    const jsFunctionsInjected = ref(false);
    const pendingQueue = ref<string[]>([]);
    const autoHeight = ref<number | null>(null);

    const localApi = computed(() => {
      const api: Record<string, unknown> = {};
      for (const fn of sandboxFunctions.value) {
        api[fn.name] = fn.handler;
      }
      return api;
    });

    watch(
      () => props.content,
      (next) => {
        latestContent.value = next;
        if (shouldFlushImmediately(throttledContent.value, next)) {
          if (throttleTimer.value !== null) {
            window.clearTimeout(throttleTimer.value);
            throttleTimer.value = null;
          }
          throttledContent.value = next;
          return;
        }
        if (throttleTimer.value === null) {
          throttleTimer.value = window.setTimeout(() => {
            throttledContent.value = latestContent.value;
            throttleTimer.value = null;
          }, 1000);
        }
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      if (throttleTimer.value !== null) {
        window.clearTimeout(throttleTimer.value);
      }
    });

    const partialHtml = computed(() => {
      if (throttledContent.value.htmlComplete) return undefined;
      if (!throttledContent.value.html?.length) return undefined;
      return throttledContent.value.html.join("");
    });
    const previewBody = computed(() =>
      partialHtml.value ? processPartialHtml(partialHtml.value) : undefined,
    );
    const previewStyles = computed(() =>
      partialHtml.value ? extractCompleteStyles(partialHtml.value) : "",
    );
    const fullHtml = computed(() =>
      throttledContent.value.htmlComplete && throttledContent.value.html?.length
        ? throttledContent.value.html.join("")
        : undefined,
    );
    const css = computed(() =>
      throttledContent.value.cssComplete
        ? throttledContent.value.css
        : undefined,
    );
    const hasPreview = computed(
      () =>
        !!throttledContent.value.cssComplete &&
        !!previewBody.value &&
        previewBody.value.trim().length > 0,
    );
    const hasVisibleSandbox = computed(
      () => !!fullHtml.value || hasPreview.value,
    );
    // The measured height grows the frame to fit its content, but never
    // shrinks it below a provided `initialHeight`.
    const resolvedHeight = computed(() => {
      const { initialHeight } = throttledContent.value;
      const height =
        autoHeight.value === null
          ? (initialHeight ?? 200)
          : Math.max(autoHeight.value, initialHeight ?? 0);
      return `${height}px`;
    });

    const destroyPreview = () => {
      if (previewSandboxRef.value) {
        previewSandboxRef.value.destroy();
        previewSandboxRef.value = null;
      }
      previewReady.value = false;
    };

    const destroyFinal = () => {
      if (sandboxRef.value) {
        sandboxRef.value.destroy();
        sandboxRef.value = null;
      }
      sandboxReady.value = false;
      pendingQueue.value = [];
      executedExpressionIndex.value = 0;
      jsFunctionsInjected.value = false;
    };

    watch(
      [
        hasPreview,
        fullHtml,
        css,
        previewBody,
        previewStyles,
        () => containerRef.value,
      ],
      async ([previewVisible, htmlComplete], _previous, onCleanup) => {
        if (!previewVisible || htmlComplete || !containerRef.value) return;
        if (previewSandboxRef.value) return;

        let cancelled = false;
        try {
          const Websandbox = await loadWebsandbox();
          if (cancelled || !containerRef.value) return;

          const sandbox = Websandbox.create(
            {},
            {
              frameContainer: containerRef.value,
              frameContent: "<head></head><body></body>",
              allowAdditionalAttributes: "",
            },
          );
          previewSandboxRef.value = sandbox;
          sandbox.iframe.setAttribute(
            "data-testid",
            "open-generative-ui-preview-sandbox",
          );
          sandbox.iframe.style.width = "100%";
          sandbox.iframe.style.height = "100%";
          sandbox.iframe.style.border = "none";
          sandbox.iframe.style.backgroundColor = "transparent";

          sandbox.promise.then(() => {
            if (cancelled || !previewSandboxRef.value) return;
            previewReady.value = true;
            void sandbox.run(
              "var s=document.createElement('style');s.textContent='html, body { overflow: hidden !important; }';document.head.appendChild(s);",
            );
          });
        } catch (error) {
          console.error(
            "[OpenGenerativeUI] Failed to load sandbox module:",
            error,
          );
        }

        onCleanup(() => {
          cancelled = true;
        });
      },
      { immediate: true },
    );

    watch(
      [previewBody, previewStyles, css, previewReady],
      ([body, styles, cssText, ready]) => {
        if (!previewSandboxRef.value || !ready) return;
        const headParts: string[] = [];
        if (cssText) headParts.push(`<style>${cssText}</style>`);
        if (styles) headParts.push(styles);
        if (headParts.length) {
          void previewSandboxRef.value.run(
            `document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`,
          );
        }
        if (body) {
          void previewSandboxRef.value.run(
            `document.body.innerHTML = ${JSON.stringify(body)}`,
          );
        }
      },
      { immediate: true },
    );

    watch(
      [fullHtml, css, localApi, () => containerRef.value],
      async ([html, cssText, api], _previous, onCleanup) => {
        destroyFinal();
        if (!html || !containerRef.value) return;
        destroyPreview();

        let cancelled = false;
        try {
          const Websandbox = await loadWebsandbox();
          if (cancelled || !containerRef.value) return;
          const htmlWithHead = ensureHead(html);
          const htmlWithCss = cssText
            ? injectCssIntoHtml(htmlWithHead, cssText)
            : htmlWithHead;
          const sandbox = Websandbox.create(api, {
            frameContainer: containerRef.value,
            frameContent: htmlWithCss,
            allowAdditionalAttributes: "",
          });
          sandboxRef.value = sandbox;
          sandbox.iframe.setAttribute(
            "data-testid",
            "open-generative-ui-final-sandbox",
          );
          sandbox.iframe.style.width = "100%";
          sandbox.iframe.style.height = "100%";
          sandbox.iframe.style.border = "none";
          sandbox.iframe.style.backgroundColor = "transparent";

          sandbox.promise.then(() => {
            if (cancelled || !sandboxRef.value) return;
            sandboxReady.value = true;
            void sandbox.run(
              "var s=document.createElement('style');s.textContent='html, body { overflow: hidden !important; }';document.head.appendChild(s);",
            );
            const functionsCode = throttledContent.value.jsFunctions;
            if (functionsCode && !jsFunctionsInjected.value) {
              jsFunctionsInjected.value = true;
              pendingQueue.value.unshift(functionsCode);
            }
            const expressions = throttledContent.value.jsExpressions;
            if (expressions?.length) {
              const startIndex = executedExpressionIndex.value;
              if (startIndex < expressions.length) {
                pendingQueue.value.push(...expressions.slice(startIndex));
                executedExpressionIndex.value = expressions.length;
              }
            }
            const queue = [...pendingQueue.value];
            pendingQueue.value = [];
            for (const code of queue) {
              void sandbox.run(code);
            }
          });
        } catch (error) {
          console.error(
            "[OpenGenerativeUI] Failed to load sandbox module:",
            error,
          );
        }

        onCleanup(() => {
          cancelled = true;
        });
      },
      { immediate: true },
    );

    watch(
      () => throttledContent.value.jsFunctions,
      (functionsCode) => {
        if (!functionsCode || jsFunctionsInjected.value) return;
        jsFunctionsInjected.value = true;
        if (sandboxReady.value && sandboxRef.value) {
          void sandboxRef.value.run(functionsCode);
        } else {
          pendingQueue.value.push(functionsCode);
        }
      },
    );

    watch(
      () => throttledContent.value.jsExpressions,
      (expressions) => {
        if (!expressions?.length) return;
        const startIndex = executedExpressionIndex.value;
        if (startIndex >= expressions.length) return;
        const newExpressions = expressions.slice(startIndex);
        executedExpressionIndex.value = expressions.length;
        if (sandboxReady.value && sandboxRef.value) {
          for (const expression of newExpressions) {
            void sandboxRef.value.run(expression);
          }
        } else {
          pendingQueue.value.push(...newExpressions);
        }
      },
      { deep: true },
    );

    const isGenerating = computed(
      () => throttledContent.value.generating !== false,
    );

    // One-shot height measurement once generation completes, for each sandbox
    // (so content that is already complete when its sandbox mounts is sized
    // too). Uses body.scrollHeight, not documentElement.scrollHeight: the
    // latter is clamped to the iframe viewport and can never shrink below it.
    watch(
      [isGenerating, sandboxRef],
      ([generating, sandbox], _previous, onCleanup) => {
        if (generating || !sandbox) return;

        let handled = false;
        const onMessage = (event: MessageEvent) => {
          if (handled) return;
          if (
            event.source === sandbox.iframe.contentWindow &&
            event.data?.type === "__ck_resize"
          ) {
            handled = true;
            autoHeight.value = event.data.height;
            window.removeEventListener("message", onMessage);
          }
        };
        window.addEventListener("message", onMessage);

        if (sandboxReady.value) {
          void sandbox.run(MEASURE_HEIGHT_ONCE);
        } else {
          pendingQueue.value.push(MEASURE_HEIGHT_ONCE);
        }

        onCleanup(() => window.removeEventListener("message", onMessage));
      },
      { immediate: true },
    );
    watch(
      [hasPreview, fullHtml],
      ([previewVisible, html]) => {
        if (html) destroyPreview();
        if (!previewVisible) destroyPreview();
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      if (throttleTimer.value !== null) {
        window.clearTimeout(throttleTimer.value);
      }
      destroyPreview();
      destroyFinal();
    });

    return () =>
      h(
        "div",
        {
          ref: containerRef,
          "data-testid": "open-generative-ui-renderer",
          style: {
            position: "relative",
            width: "100%",
            height: resolvedHeight.value,
            borderRadius: "var(--radius, 8px)",
            backgroundColor: hasVisibleSandbox.value
              ? "transparent"
              : "var(--muted, #f5f5f5)",
            border: hasVisibleSandbox.value
              ? "none"
              : "1px solid var(--border, #e5e5e5)",
            overflow: "hidden",
            display: hasVisibleSandbox.value ? "block" : "flex",
            alignItems: hasVisibleSandbox.value ? undefined : "center",
            justifyContent: hasVisibleSandbox.value ? undefined : "center",
          },
        },
        [
          !hasVisibleSandbox.value
            ? h("div", { "data-testid": "open-generative-ui-placeholder" }, [
                h(
                  "svg",
                  {
                    width: "48",
                    height: "48",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    style: { animation: "ck-spin 1s linear infinite" },
                  },
                  [
                    h("circle", {
                      cx: "12",
                      cy: "12",
                      r: "10",
                      style: { stroke: "var(--border, #e5e5e5)" },
                      "stroke-width": "3",
                    }),
                    h("path", {
                      d: "M12 2a10 10 0 0 1 10 10",
                      style: { stroke: "var(--muted-foreground, #737373)" },
                      "stroke-width": "3",
                      "stroke-linecap": "round",
                    }),
                  ],
                ),
                h(
                  "style",
                  "@keyframes ck-spin { to { transform: rotate(360deg) } }",
                ),
              ])
            : null,
          isGenerating.value
            ? h("div", {
                "data-testid": "open-generative-ui-progress-overlay",
                style: {
                  position: "absolute",
                  inset: 0,
                  backgroundColor:
                    "color-mix(in oklab, var(--background, #fff) 45%, transparent)",
                },
              })
            : null,
        ],
      );
  },
});

export const OpenGenerativeUIActivityRenderer = defineComponent({
  name: "OpenGenerativeUIActivityRenderer",
  props: {
    activityType: { type: String, required: true },
    content: {
      type: Object as PropType<OpenGenerativeUIContent>,
      required: true,
    },
    message: { type: Object as PropType<unknown>, required: true },
    agent: {
      type: Object as PropType<unknown>,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    return () => h(OpenGenerativeUIRenderer, { content: props.content });
  },
});

export const OpenGenerativeUIToolRenderer = defineComponent({
  name: "OpenGenerativeUIToolRenderer",
  props: {
    name: { type: String, required: true },
    args: {
      type: Object as PropType<Partial<GenerateSandboxedUiArgs>>,
      required: true,
    },
    status: { type: String as PropType<ToolCallStatus>, required: true },
    result: { type: String as PropType<string | undefined>, required: false },
  },
  setup(props) {
    const visibleMessageIndex = ref(0);

    watch(
      () => props.args.placeholderMessages,
      (messages, _, onCleanup) => {
        if (!messages?.length || props.status === ToolCallStatus.Complete)
          return;
        visibleMessageIndex.value = Math.max(messages.length - 1, 0);
        const timer = window.setInterval(() => {
          visibleMessageIndex.value =
            (visibleMessageIndex.value + 1) % Math.max(messages.length, 1);
        }, 5000);
        onCleanup(() => window.clearInterval(timer));
      },
      { immediate: true },
    );

    return () => {
      if (props.status === ToolCallStatus.Complete) return null;
      const messages = props.args.placeholderMessages;
      if (!messages?.length) return null;
      const currentMessage = messages[visibleMessageIndex.value] ?? messages[0];
      return h(
        "div",
        {
          style: {
            padding: "8px 12px",
            color: "var(--muted-foreground, #737373)",
            fontSize: "14px",
          },
          "data-testid": "open-generative-ui-tool-placeholder",
        },
        currentMessage,
      );
    };
  },
});
