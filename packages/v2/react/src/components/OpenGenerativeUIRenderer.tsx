"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkitnext/core";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";
import { processPartialHtml, extractCompleteStyles } from "../lib/processPartialHtml";

export const OpenGenerativeUIActivityType = "open-generative-ui";

export const OpenGenerativeUIContentSchema = z.object({
  initialHeight: z.number().optional(),
  generating: z.boolean().optional(),
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

function ensureHead(html: string): string {
  if (/<head[\s>]/i.test(html)) return html;
  return `<head></head>${html}`;
}

export const OpenGenerativeUIActivityRenderer: React.FC<
  OpenGenerativeUIActivityRendererProps
> = function OpenGenerativeUIActivityRenderer({ content }) {
  const initialHeight = content.initialHeight ?? 200;
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
  const sandboxFunctions = useSandboxFunctions();

  const localApi = useMemo(() => {
    const api: Record<string, Function> = {};
    for (const fn of sandboxFunctions) {
      api[fn.name] = fn.handler;
    }
    return api;
  }, [sandboxFunctions]);

  // Join html chunks only when streaming is complete
  const fullHtml = content.htmlComplete && content.html?.length
    ? content.html.join("")
    : undefined;

  // Derived state for preview streaming
  const partialHtml = !content.htmlComplete && content.html?.length
    ? content.html.join("")
    : undefined;
  const previewBody = partialHtml ? processPartialHtml(partialHtml) : undefined;
  const previewStyles = partialHtml ? extractCompleteStyles(partialHtml) : "";
  const hasPreview = !!previewBody?.trim();
  const hasVisibleSandbox = !!fullHtml || hasPreview;

  const containerRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<{ run: (code: string | Function) => Promise<unknown>; destroy: () => void; iframe: HTMLIFrameElement } | null>(null);
  const previewSandboxRef = useRef<{ run: (code: string | Function) => Promise<unknown>; destroy: () => void; iframe: HTMLIFrameElement } | null>(null);
  const previewReadyRef = useRef(false);
  const sandboxReadyRef = useRef(false);
  const executedIndexRef = useRef(0);
  const pendingQueueRef = useRef<string[]>([]);
  const jsFunctionsInjectedRef = useRef(false);

  // Effect 0 — Preview sandbox creation
  useEffect(() => {
    const container = containerRef.current;
    if (!container || fullHtml || !hasPreview || previewSandboxRef.current) return;

    let cancelled = false;

    import("@jetbrains/websandbox").then((mod: any) => {
      if (cancelled) return;

      const Websandbox = mod.default?.default ?? mod.default;
      const sandbox = Websandbox.create({}, {
        frameContainer: container,
        frameContent: "<head></head><body></body>",
        allowAdditionalAttributes: "",
      });
      previewSandboxRef.current = sandbox;

      sandbox.iframe.style.width = "100%";
      sandbox.iframe.style.height = "100%";
      sandbox.iframe.style.border = "none";
      sandbox.iframe.style.backgroundColor = "transparent";

      sandbox.promise.then(() => {
        if (cancelled) return;
        previewReadyRef.current = true;

        // Apply current preview content immediately
        if (previewStyles) {
          sandbox.run(`document.head.innerHTML = ${JSON.stringify(previewStyles)}`);
        }
        if (previewBody) {
          sandbox.run(`document.body.innerHTML = ${JSON.stringify(previewBody)}`);
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [hasPreview, fullHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 0b — Throttled preview content updates (body + styles, max ~3/sec)
  // Store latest values in refs so the interval reads them without re-running the effect
  const latestPreviewBodyRef = useRef(previewBody);
  latestPreviewBodyRef.current = previewBody;
  const latestPreviewStylesRef = useRef(previewStyles);
  latestPreviewStylesRef.current = previewStyles;
  const lastInjectedBodyRef = useRef<string | null>(null);
  const lastInjectedStylesRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasPreview) return;

    const interval = setInterval(() => {
      if (!previewSandboxRef.current || !previewReadyRef.current) return;

      const styles = latestPreviewStylesRef.current;
      if (styles && styles !== lastInjectedStylesRef.current) {
        lastInjectedStylesRef.current = styles;
        previewSandboxRef.current.run(`document.head.innerHTML = ${JSON.stringify(styles)}`);
      }

      const body = latestPreviewBodyRef.current;
      if (!body || body === lastInjectedBodyRef.current) return;
      lastInjectedBodyRef.current = body;
      previewSandboxRef.current.run(`document.body.innerHTML = ${JSON.stringify(body)}`);
    }, 300);

    return () => clearInterval(interval);
  }, [hasPreview]);

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

    // Dynamic import to avoid SSR issues (websandbox references `self` at module level)
    const htmlContent = fullHtml;
    import("@jetbrains/websandbox").then((mod: any) => {
      if (cancelled) return;

      // websandbox ships a UMD bundle with its own webpack `default` export.
      // Consumer bundlers (e.g. Next.js webpack) wrap CJS under another `.default`,
      // resulting in mod.default.default for the actual Websandbox class.
      const Websandbox = mod.default?.default ?? mod.default;
      const sandbox = Websandbox.create(localApi, {
        frameContainer: container,
        frameContent: ensureHead(htmlContent),
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

        // Flush pending queue
        const queue = pendingQueueRef.current;
        pendingQueueRef.current = [];
        for (const code of queue) {
          sandbox.run(code);
        }
      });
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
  }, [fullHtml, localApi]);

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

  // All content is complete — html, jsFunctions, and jsExpressions are all done
  const allContentComplete = !!content.htmlComplete
    && (content.jsFunctionsComplete || !content.jsFunctions)
    && (content.jsExpressionsComplete || !content.jsExpressions?.length);

  // Effect 4 — ResizeObserver injection (only when all content is complete)
  useEffect(() => {
    const sandbox = sandboxRef.current;
    if (!allContentComplete || !sandbox) return;

    const onMessage = (e: MessageEvent) => {
      if (e.source === sandbox.iframe.contentWindow && e.data?.type === "__ck_resize") {
        setAutoHeight(e.data.height);
      }
    };
    window.addEventListener("message", onMessage);

    const inject = () => {
      sandbox.run(`
        (function() {
          var ro = new ResizeObserver(function() {
            var h = document.documentElement.scrollHeight;
            parent.postMessage({ type: "__ck_resize", height: h }, "*");
          });
          ro.observe(document.documentElement);
        })();
      `);
    };

    if (sandboxReadyRef.current) {
      inject();
    } else {
      pendingQueueRef.current.push(`
        (function() {
          var ro = new ResizeObserver(function() {
            var h = document.documentElement.scrollHeight;
            parent.postMessage({ type: "__ck_resize", height: h }, "*");
          });
          ro.observe(document.documentElement);
        })();
      `);
    }

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [allContentComplete]);

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
};

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

    // Auto-cycle every 3s while still in progress
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
