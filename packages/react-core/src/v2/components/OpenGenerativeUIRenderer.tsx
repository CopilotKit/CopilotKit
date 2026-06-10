"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";
import { useOpenGenerativeUIOptions } from "../providers/OpenGenerativeUIOptionsContext";
import { assembleDocument } from "../lib/assembleDocument";
import {
  processPartialHtml,
  extractCompleteStyles,
} from "../lib/processPartialHtml";

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

/**
 * Schema for the generateSandboxedUi tool call arguments.
 * Used by the frontend tool renderer to display placeholder messages.
 */
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

interface OpenGenerativeUIActivityRendererProps {
  activityType: string;
  content: OpenGenerativeUIContent;
  message: unknown;
  agent: unknown;
}

const THROTTLE_MS = 1000;

/**
 * One-shot height measurement script. Temporarily forces `body` to auto-size,
 * reads `body.scrollHeight` (plus vertical margins), then posts the result back
 * to the parent as a `__ck_resize` message. Static — hoisted so both Effect 4
 * (initial measurement) and Effect 1 (re-measure on rebuild) reference the same
 * string. Uses body.scrollHeight (not documentElement.scrollHeight) because the
 * latter is clamped to the iframe viewport and can never shrink below the
 * current size.
 */
const MEASURE_ONCE_SCRIPT = `
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
 * Returns true when the inner component should re-render immediately
 * (no throttle delay).
 */
function shouldFlushImmediately(
  prev: OpenGenerativeUIContent | null,
  next: OpenGenerativeUIContent,
): boolean {
  // CSS finished — switch from placeholder to preview
  if (next.cssComplete && (!prev || !prev.cssComplete)) return true;
  // Streaming done
  if (next.htmlComplete) return true;
  // Generation finished
  if (next.generating === false) return true;
  // jsFunctions appeared
  if (next.jsFunctions && (!prev || !prev.jsFunctions)) return true;
  // jsExpressions grew
  if ((next.jsExpressions?.length ?? 0) > (prev?.jsExpressions?.length ?? 0))
    return true;
  // First html chunk arrived (first preview — no delay)
  if (next.html?.length && (!prev || !prev.html?.length)) return true;
  return false;
}

/**
 * Outer wrapper — absorbs every parent re-render but only forwards
 * throttled content snapshots to the memoized inner component.
 */
export const OpenGenerativeUIActivityRenderer: React.FC<OpenGenerativeUIActivityRendererProps> =
  function OpenGenerativeUIActivityRenderer({ content }) {
    const latestContentRef = useRef(content);
    latestContentRef.current = content;

    const [throttledContent, setThrottledContent] =
      useState<OpenGenerativeUIContent>(content);
    const throttledContentRef = useRef(throttledContent);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Synchronous state adjustment during render (React-approved pattern).
    // When shouldFlushImmediately is true, update state before commit so the
    // inner component sees the new content in the same render pass — no extra
    // async cycle that would break test timing.
    if (throttledContentRef.current !== content) {
      if (shouldFlushImmediately(throttledContentRef.current, content)) {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        throttledContentRef.current = content;
        setThrottledContent(content);
      }
    }

    const flush = useCallback(() => {
      timerRef.current = null;
      const latest = latestContentRef.current;
      throttledContentRef.current = latest;
      setThrottledContent(latest);
    }, []);

    // Schedule throttled updates for non-immediate content changes
    useEffect(() => {
      // Already up to date (initial render or synchronous flush above)
      if (throttledContentRef.current === content) return;

      // Schedule a throttled flush if none pending
      if (timerRef.current === null) {
        timerRef.current = setTimeout(flush, THROTTLE_MS);
      }
    }, [content, flush]);

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
      };
    }, []);

    return <OpenGenerativeUIActivityRendererInner content={throttledContent} />;
  };

// ---------------------------------------------------------------------------
// Inner component — all the expensive work, protected by React.memo
// ---------------------------------------------------------------------------

interface InnerProps {
  content: OpenGenerativeUIContent;
}

const OpenGenerativeUIActivityRendererInner = React.memo(
  function OpenGenerativeUIActivityRendererInner({ content }: InnerProps) {
    const initialHeight = content.initialHeight ?? 200;
    const [autoHeight, setAutoHeight] = useState<number | null>(null);
    const sandboxFunctions = useSandboxFunctions();
    const { designSystemCss, importMap } = useOpenGenerativeUIOptions();

    const localApi = useMemo(() => {
      const api: Record<string, Function> = {};
      for (const fn of sandboxFunctions) {
        api[fn.name] = fn.handler;
      }
      return api;
    }, [sandboxFunctions]);

    // Join html chunks only when streaming is complete
    const fullHtml =
      content.htmlComplete && content.html?.length
        ? content.html.join("")
        : undefined;

    // CSS from the dedicated parameter (available once cssComplete)
    const css = content.cssComplete ? content.css : undefined;

    // Derived state for preview streaming — gate on cssComplete so we
    // show the placeholder until styles are ready.
    const cssReady = !!content.cssComplete;
    const partialHtml =
      !content.htmlComplete && content.html?.length
        ? content.html.join("")
        : undefined;
    const previewBody = partialHtml
      ? processPartialHtml(partialHtml)
      : undefined;
    const previewStyles = partialHtml ? extractCompleteStyles(partialHtml) : "";
    const hasPreview = cssReady && !!previewBody?.trim();
    const hasVisibleSandbox = !!fullHtml || hasPreview;

    const containerRef = useRef<HTMLDivElement>(null);
    const sandboxRef = useRef<{
      run: (code: string | Function) => Promise<unknown>;
      destroy: () => void;
      iframe: HTMLIFrameElement;
    } | null>(null);
    const previewSandboxRef = useRef<{
      run: (code: string | Function) => Promise<unknown>;
      destroy: () => void;
      iframe: HTMLIFrameElement;
    } | null>(null);
    const previewReadyRef = useRef(false);
    const sandboxReadyRef = useRef(false);
    const executedIndexRef = useRef(0);
    const pendingQueueRef = useRef<string[]>([]);
    const jsFunctionsInjectedRef = useRef(false);
    // Tracks whether Effect 1 has already built a final sandbox. Survives the
    // effect's cleanup (unlike sandboxRef, which the cleanup nulls), so Effect 1
    // can tell a first build from a rebuild and only re-measure on rebuilds —
    // the first measurement is owned by Effect 4.
    const finalSandboxBuiltRef = useRef(false);

    // Effect 0 — Preview sandbox creation
    useEffect(() => {
      const container = containerRef.current;
      if (!container || fullHtml || !hasPreview || previewSandboxRef.current)
        return;

      let cancelled = false;

      import("@jetbrains/websandbox")
        .then((mod: any) => {
          if (cancelled) return;

          const Websandbox = mod.default?.default ?? mod.default;
          const sandbox = Websandbox.create(
            {},
            {
              frameContainer: container,
              frameContent: "<head></head><body></body>",
              allowAdditionalAttributes: "",
            },
          );
          previewSandboxRef.current = sandbox;

          sandbox.iframe.style.width = "100%";
          sandbox.iframe.style.height = "100%";
          sandbox.iframe.style.border = "none";
          sandbox.iframe.style.backgroundColor = "transparent";

          sandbox.promise.then(() => {
            if (cancelled) return;
            previewReadyRef.current = true;

            // Inject CSS from the dedicated parameter + any inline styles from HTML.
            // The overflow guard must be part of the assigned head content (not a
            // separate append) so it survives the head.innerHTML assignment.
            // Order: overflow guard → kit → agent css → extracted preview styles
            const headParts: string[] = [
              "<style data-ck-preview-overflow>html, body { overflow: hidden !important; }</style>",
            ];
            if (designSystemCss)
              headParts.push(
                `<style data-ck-design-system>${designSystemCss}</style>`,
              );
            if (css) headParts.push(`<style>${css}</style>`);
            if (previewStyles) headParts.push(previewStyles);
            sandbox.run(
              `document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`,
            );
            if (previewBody) {
              sandbox.run(
                `document.body.innerHTML = ${JSON.stringify(previewBody)}`,
              );
            }
          });
        })
        .catch((err: unknown) => {
          console.error(
            "[OpenGenerativeUI] Failed to load sandbox module:",
            err,
          );
        });

      return () => {
        cancelled = true;
      };
    }, [hasPreview, fullHtml]); // eslint-disable-line react-hooks/exhaustive-deps

    // Effect 0b — Preview content updates (body + styles)
    useEffect(() => {
      if (!previewSandboxRef.current || !previewReadyRef.current) return;
      // The overflow guard must be part of the assigned head content (not a
      // separate append) so it survives the head.innerHTML assignment.
      // Order: overflow guard → kit → agent css → extracted preview styles
      const headParts: string[] = [
        "<style data-ck-preview-overflow>html, body { overflow: hidden !important; }</style>",
      ];
      if (designSystemCss)
        headParts.push(
          `<style data-ck-design-system>${designSystemCss}</style>`,
        );
      if (css) headParts.push(`<style>${css}</style>`);
      if (previewStyles) headParts.push(previewStyles);
      previewSandboxRef.current.run(
        `document.head.innerHTML = ${JSON.stringify(headParts.join(""))}`,
      );
      if (!previewBody) return;
      previewSandboxRef.current.run(
        `document.body.innerHTML = ${JSON.stringify(previewBody)}`,
      );
      // designSystemCss is a stable context value (set once at provider mount)
    }, [previewBody, previewStyles, css, designSystemCss]);

    // Effect 1 — Final sandbox lifecycle (depends on fullHtml)
    useEffect(() => {
      const container = containerRef.current;
      if (!container || !fullHtml) return;

      // Destroy preview sandbox when transitioning to final
      if (previewSandboxRef.current) {
        previewSandboxRef.current.destroy();
        previewSandboxRef.current = null;
        previewReadyRef.current = false;
      }

      let cancelled = false;

      // Reset state for new html
      executedIndexRef.current = 0;
      jsFunctionsInjectedRef.current = false;
      sandboxReadyRef.current = false;
      pendingQueueRef.current = [];

      // Re-queue current JS so a rebuilt sandbox is never left without its behavior
      // (Effects 2/3 won't re-fire when the rebuild trigger isn't a JS change).
      // Setting the guards here makes Effects 2/3 skip on first mount (they run
      // after this effect in the same commit), avoiding double-execution.
      // content.jsFunctions/jsExpressions are read as a rebuild-time snapshot and
      // are intentionally not in the dep array; the memoized inner component
      // re-renders on content change so this closure is always current.
      // Replay semantics: a rebuild intentionally REPLAYS jsFunctions/jsExpressions
      // (and re-measures below) so the artifact stays alive — expressions with host
      // side effects therefore re-fire on every rebuild.
      if (content.jsFunctions) {
        pendingQueueRef.current.push(content.jsFunctions);
        jsFunctionsInjectedRef.current = true;
      }
      if (content.jsExpressions?.length) {
        pendingQueueRef.current.push(...content.jsExpressions);
        executedIndexRef.current = content.jsExpressions.length;
      }
      // Re-measure when REBUILDING an already-completed artifact. Effect 4 (keyed
      // on generationDone) measured the first sandbox and won't re-fire for a
      // rebuild, so the new sandbox would stay clamped at initialHeight and clip
      // taller content. Guard on finalSandboxBuiltRef so this fires only on a
      // rebuild — on the first build Effect 4 still owns the measurement (pushing
      // here too would queue it twice). Push the measurement last (functions →
      // expressions → measure); the still-attached __ck_resize listener resolves
      // sandboxRef lazily, so it matches this new sandbox.
      if (content.generating === false && finalSandboxBuiltRef.current) {
        pendingQueueRef.current.push(MEASURE_ONCE_SCRIPT);
      }
      finalSandboxBuiltRef.current = true;

      // Dynamic import to avoid SSR issues (websandbox references `self` at module level)
      const htmlContent = assembleDocument(fullHtml, {
        css,
        designSystemCss,
        importMap,
      });
      import("@jetbrains/websandbox")
        .then((mod: any) => {
          if (cancelled) return;

          // websandbox ships a UMD bundle with its own webpack `default` export.
          // Consumer bundlers (e.g. Next.js webpack) wrap CJS under another `.default`,
          // resulting in mod.default.default for the actual Websandbox class.
          const Websandbox = mod.default?.default ?? mod.default;
          const sandbox = Websandbox.create(localApi, {
            frameContainer: container,
            frameContent: htmlContent,
            allowAdditionalAttributes: "",
          });
          sandboxRef.current = sandbox;

          // Style the iframe to fill container
          sandbox.iframe.style.width = "100%";
          sandbox.iframe.style.height = "100%";
          sandbox.iframe.style.border = "none";
          sandbox.iframe.style.backgroundColor = "transparent";

          sandbox.promise.then(() => {
            if (cancelled) return;
            sandboxReadyRef.current = true;

            // Prevent scrollbars — the container auto-sizes to fit content
            sandbox.run(`
            var s = document.createElement('style');
            s.textContent = 'html, body { overflow: hidden !important; }';
            document.head.appendChild(s);
          `);

            // Flush pending queue
            const queue = pendingQueueRef.current;
            pendingQueueRef.current = [];
            for (const code of queue) {
              sandbox.run(code);
            }
          });
        })
        .catch((err: unknown) => {
          console.error(
            "[OpenGenerativeUI] Failed to load sandbox module:",
            err,
          );
        });

      return () => {
        cancelled = true;
        // Destroy preview sandbox if it still exists
        if (previewSandboxRef.current) {
          previewSandboxRef.current.destroy();
          previewSandboxRef.current = null;
          previewReadyRef.current = false;
        }
        if (sandboxRef.current) {
          sandboxRef.current.destroy();
          sandboxRef.current = null;
        }
        sandboxReadyRef.current = false;
        setAutoHeight(null);
      };
      // designSystemCss and importMap are stable context values (set once at provider mount).
      // content.jsFunctions/jsExpressions are read as a rebuild-time snapshot only (see re-queue
      // block above); including them would re-run the whole sandbox lifecycle on every JS change.
    }, [fullHtml, css, localApi, designSystemCss, importMap]); // eslint-disable-line react-hooks/exhaustive-deps

    // Effect 2 — jsFunctions injection (depends on content.jsFunctions)
    useEffect(() => {
      if (!content.jsFunctions || jsFunctionsInjectedRef.current) return;
      jsFunctionsInjectedRef.current = true;

      const sandbox = sandboxRef.current;
      if (sandboxReadyRef.current && sandbox) {
        sandbox.run(content.jsFunctions);
      } else {
        pendingQueueRef.current.push(content.jsFunctions);
      }
    }, [content.jsFunctions]);

    // Effect 3 — jsExpressions execution (depends on content.jsExpressions?.length)
    useEffect(() => {
      const expressions = content.jsExpressions;
      if (!expressions || expressions.length === 0) return;

      const startIndex = executedIndexRef.current;
      if (startIndex >= expressions.length) return;

      const newExprs = expressions.slice(startIndex);
      executedIndexRef.current = expressions.length;

      const sandbox = sandboxRef.current;
      if (sandboxReadyRef.current && sandbox) {
        (async () => {
          for (const expr of newExprs) {
            await sandbox.run(expr);
          }
        })();
      } else {
        pendingQueueRef.current.push(...newExprs);
      }
    }, [content.jsExpressions?.length]);

    // Effect 4 — Height measurement listener (attached once generation completes)
    const generationDone = content.generating === false;
    useEffect(() => {
      if (!generationDone) return;

      // The listener stays armed for the lifetime of this effect — it is NOT
      // one-shot. Cleanup only runs when generationDone changes or the component
      // unmounts; a post-completion rebuild (Effect 1) triggers neither, so the
      // same listener must keep serving the rebuilt sandbox. It applies EVERY
      // accepted __ck_resize rather than latching after the first.
      const onMessage = (e: MessageEvent) => {
        // Read sandboxRef lazily so the comparison always targets the CURRENT
        // sandbox: on the fast-completion path the sandbox may still be null when
        // this listener is attached (capturing it in the closure would drop the
        // message), and after a rebuild sandboxRef.current points at the NEW
        // iframe. A stale iframe's message therefore fails this check and is
        // ignored. The measurement script posts exactly once per execution, so
        // each accepted message is one-per-build — applying every one cannot loop.
        if (
          e.source === sandboxRef.current?.iframe?.contentWindow &&
          e.data?.type === "__ck_resize"
        ) {
          setAutoHeight(e.data.height);
        }
      };
      window.addEventListener("message", onMessage);

      // When generation completes in the same commit that schedules sandbox
      // creation (reconnect/restore + non-streaming completion), sandboxRef is
      // still null here. Queue the measurement so Effect 1's sandbox.promise.then
      // flushes it after jsFunctions/jsExpressions (measure last). Effect 1 runs
      // earlier in the same commit and resets pendingQueueRef before this push,
      // so the queued script survives.
      if (sandboxReadyRef.current && sandboxRef.current) {
        sandboxRef.current.run(MEASURE_ONCE_SCRIPT);
      } else {
        pendingQueueRef.current.push(MEASURE_ONCE_SCRIPT);
      }

      // This effect arms the listener and queues the FIRST measurement. A
      // rebuild after completion does not re-fire this effect (it is keyed on
      // generationDone), so Effect 1's re-queue block re-pushes
      // MEASURE_ONCE_SCRIPT for the rebuilt sandbox — and because the listener
      // above stays armed across the rebuild, that measurement is applied too.
      return () => {
        window.removeEventListener("message", onMessage);
      };
    }, [generationDone]);

    const height = autoHeight ?? initialHeight;

    const isGenerating = content.generating !== false;

    return (
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: `${height}px`,
          borderRadius: "8px",
          backgroundColor: hasVisibleSandbox ? "transparent" : "#f5f5f5",
          border: hasVisibleSandbox ? "none" : "1px solid #e0e0e0",
          display: hasVisibleSandbox ? "block" : "flex",
          alignItems: hasVisibleSandbox ? undefined : "center",
          justifyContent: hasVisibleSandbox ? undefined : "center",
          overflow: "hidden",
        }}
      >
        {isGenerating && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              pointerEvents: "all",
              backgroundColor: "rgba(255, 255, 255, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              style={{ animation: "ck-spin 1s linear infinite" }}
            >
              <circle cx="12" cy="12" r="10" stroke="#e0e0e0" strokeWidth="3" />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                stroke="#999"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <style>{`@keyframes ck-spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => prev.content === next.content,
);

/**
 * Frontend tool renderer for generateSandboxedUi.
 * Displays placeholder messages while the UI is being generated.
 */
export const OpenGenerativeUIToolRenderer: React.FC<
  | {
      name: string;
      args: Partial<GenerateSandboxedUiArgs>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      args: GenerateSandboxedUiArgs;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      args: GenerateSandboxedUiArgs;
      status: ToolCallStatus.Complete;
      result: string;
    }
> = function OpenGenerativeUIToolRenderer(props) {
  const [visibleMessageIndex, setVisibleMessageIndex] = useState(0);
  const prevMessageCountRef = useRef(0);

  const messages = props.args.placeholderMessages;

  // Cycle through placeholder messages
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // When a new message streams in, jump to it immediately
    if (messages.length !== prevMessageCountRef.current) {
      prevMessageCountRef.current = messages.length;
      setVisibleMessageIndex(messages.length - 1);
    }

    // Auto-cycle every 5s while still in progress
    if (props.status === ToolCallStatus.Complete) return;
    const timer = setInterval(() => {
      setVisibleMessageIndex((i) => (i + 1) % messages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [messages?.length, props.status]);

  // Don't render anything once complete — the activity renderer handles the UI
  if (props.status === ToolCallStatus.Complete) return null;

  if (!messages || messages.length === 0) return null;

  return (
    <div
      style={{
        padding: "8px 12px",
        color: "#999",
        fontSize: "14px",
      }}
    >
      {messages[visibleMessageIndex] ?? messages[0]}
    </div>
  );
};
