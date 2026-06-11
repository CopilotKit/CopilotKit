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

// Match only a real head-opening tag: `<head>`, or `<head` followed by
// whitespace + attributes. This deliberately excludes `<header …>` (which a
// looser `/<head[^>]*>/i` would capture). The attribute span is quote-aware:
// unquoted runs forbid `<`/`>` (so the tag can never greedily swallow a
// following `<tag>`), while quoted runs (`"…"` / `'…'`) may contain `<`/`>` so
// a realistic `<head data-config='{"a":">"}'>` is matched whole. Mirrors
// react-core's assembleDocument head-open matcher.
const HEAD_OPEN = /<head(\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/i;

/**
 * Ensures the final frameContent contains the EXACT literal lowercase token
 * `<head>`. @jetbrains/websandbox hard-requires it: validateOptions throws
 * `'Websandbox: iFrame content must have "<head>" tag.'` when
 * `!frameContent.includes('<head>')`, and it injects its bootstrap via
 * `frameContent.replace('<head>', …)` — both case-sensitive on the 6-char
 * token. An agent-emitted `<HEAD>` or `<head lang="en">` would otherwise fail
 * mounting (stuck spinner) and never receive the bootstrap.
 *
 * If a real head-opening tag exists, its token is NORMALIZED to `<head>` (head
 * attributes have negligible runtime semantics inside the sandbox iframe and
 * cannot be preserved given websandbox's exact-token demand). If none exists,
 * `<head></head>` is prepended. Mirrors react-core's normalization.
 */
function ensureHead(html: string): string {
  const match = html.match(HEAD_OPEN);
  if (match && match.index !== undefined) {
    if (match[0] === "<head>") return html;
    return (
      html.slice(0, match.index) +
      "<head>" +
      html.slice(match.index + match[0].length)
    );
  }
  return `<head></head>${html}`;
}

/**
 * Injects the agent css immediately before `</head>` — i.e. AFTER the author's
 * existing head content — so the documented cascade holds (author head styles
 * first, agent css last; matching react-core). The close lookup is
 * case-insensitive so it pairs with `ensureHead`'s case-insensitive open match:
 * a case-sensitive `indexOf("</head>")` would miss an uppercase `</HEAD>` and
 * flip the cascade so the agent css wins over the author's head styles.
 *
 * Always called after `ensureHead`, so a real head-opening tag exists by
 * construction. Two edge shapes are guarded:
 *  - A stray `</head>` BEFORE the real head: the close search is anchored
 *    at/after the matched head-open so the css lands inside the REAL head, not
 *    at the earlier stray close (which would put it outside and before the real
 *    head — cascade inversion).
 *  - A head-open with NO matching close: the css is inserted immediately AFTER
 *    the (normalized) head-open rather than prepending a fresh `<head>`, which
 *    would otherwise create two head elements with the agent css before the
 *    author's head content. Only the no-head-at-all path (which `ensureHead`
 *    prevents here) would synthesize a brand-new head.
 */
function injectCssIntoHtml(html: string, css: string): string {
  const match = html.match(HEAD_OPEN);
  // ensureHead runs first, so a real head-opening tag exists by construction.
  // Anchor the close-tag search at/after the matched head-open so it pairs with
  // the SAME head: a global first-match `search(/<\/head>/i)` would resolve to a
  // stray `</head>` that PRECEDES the real head (e.g.
  // `foo</head><head>…</head>`), splicing the agent css outside and before the
  // real head and inverting the documented cascade. Mirrors react-core's
  // assembleDocument, which scopes the close search to after the head-open.
  const searchFrom =
    match && match.index !== undefined ? match.index + match[0].length : 0;
  const closeRel = html.slice(searchFrom).search(/<\/head>/i);
  const headCloseIdx = closeRel !== -1 ? closeRel + searchFrom : -1;
  if (headCloseIdx !== -1) {
    return (
      html.slice(0, headCloseIdx) +
      `<style>${css}</style>` +
      html.slice(headCloseIdx)
    );
  }
  // No `</head>` at/after the head-open. ensureHead guaranteed a real head-open,
  // so insert the agent css immediately AFTER that (normalized) head-open rather
  // than prepending a fresh `<head>` — which would produce two head elements
  // with the agent css before the author's head content (cascade inversion).
  // Matches react-core's post-head-open fallback.
  if (match && match.index !== undefined) {
    const insertAt = match.index + match[0].length;
    return (
      html.slice(0, insertAt) + `<style>${css}</style>` + html.slice(insertAt)
    );
  }
  return `<head><style>${css}</style></head>${html}`;
}

/**
 * Overflow guard for the preview iframe: `html, body { overflow: hidden }`. It
 * must be baked into the head innerHTML so it survives every
 * `document.head.innerHTML = …` reassignment built from head parts — a one-time
 * `head.appendChild` on ready would be clobbered by the first reassignment and
 * the preview iframe could then show scrollbars. Mirrors react-core's
 * `buildPreviewHeadHtml` (overflow guard first, then preview styles, then agent
 * css last so the cascade matches the final document). Vue has no
 * kit/design-system injection, so the only head parts are: guard → extracted
 * styles → agent css.
 */
const PREVIEW_OVERFLOW_GUARD =
  "<style data-ck-preview-overflow>html, body { overflow: hidden !important; }</style>";

function buildPreviewHeadHtml(
  previewStyles: string,
  css: string | undefined,
): string {
  const headParts: string[] = [PREVIEW_OVERFLOW_GUARD];
  if (previewStyles) headParts.push(previewStyles);
  if (css) headParts.push(`<style>${css}</style>`);
  return headParts.join("");
}

type SandboxInstance = {
  iframe: HTMLIFrameElement;
  promise: Promise<unknown>;
  run: (code: string | ((...args: unknown[]) => unknown)) => Promise<unknown>;
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

async function loadWebsandbox(): Promise<WebsandboxModule> {
  const mod = (await import("@jetbrains/websandbox")) as {
    default?: { default?: unknown } & unknown;
  };
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
    const resolvedHeight = computed(
      () => `${throttledContent.value.initialHeight ?? 200}px`,
    );

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
            // Flip ready — the content-update watcher (which lists previewReady
            // in its source) then assigns the head/body. The overflow guard is
            // baked into that head payload (buildPreviewHeadHtml), so it survives
            // every reassignment; a separate appendChild here would be clobbered
            // by the first head.innerHTML assignment. Mirrors react-core.
            previewReady.value = true;
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
        // Cascade parity: overflow guard first, then extracted head styles, then
        // agent css LAST — mirroring the final document, where injectCssIntoHtml
        // inserts the agent css immediately before </head> (after the existing
        // head content). Ordering the agent css first would flip its cascade
        // position at the preview→final swap, visibly restyling artifacts that
        // collide with it at equal specificity. The guard is ALWAYS present (so
        // the head is assigned even with no styles/css), which also keeps the
        // overflow guard from being lost when css/head styles arrive — the head
        // payload is fully rebuilt on every assignment. Mirrors react-core's
        // buildPreviewHeadHtml.
        void previewSandboxRef.value.run(
          `document.head.innerHTML = ${JSON.stringify(buildPreviewHeadHtml(styles, cssText))}`,
        );
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
            borderRadius: "8px",
            backgroundColor: hasVisibleSandbox.value
              ? "transparent"
              : "#f5f5f5",
            border: hasVisibleSandbox.value ? "none" : "1px solid #e0e0e0",
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
                      stroke: "#e0e0e0",
                      "stroke-width": "3",
                    }),
                    h("path", {
                      d: "M12 2a10 10 0 0 1 10 10",
                      stroke: "#999",
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
                  backgroundColor: "rgba(255,255,255,0.45)",
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

    // Watch status alongside placeholderMessages so a transition to Complete
    // re-runs this watcher: the onCleanup below clears the in-flight interval
    // and the Complete guard prevents re-arming. Without status in the source,
    // a stable placeholderMessages reference would leave the 5s interval firing
    // until unmount even after the call completes (the render returns null, so
    // it would be an invisible lingering timer). Mirrors react-core, which keys
    // its placeholder effect on props.status.
    watch(
      () => [props.args.placeholderMessages, props.status] as const,
      ([messages], _, onCleanup) => {
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
          style: { padding: "8px 12px", color: "#999", fontSize: "14px" },
          "data-testid": "open-generative-ui-tool-placeholder",
        },
        currentMessage,
      );
    };
  },
});
