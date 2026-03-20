"use client";

import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkitnext/core";

export const OpenGenerativeUIActivityType = "open-generative-ui";

export const OpenGenerativeUIContentSchema = z.object({
  initialHeight: z.number().optional(),
  html: z.string().optional(),
  jsFunctions: z.string().optional(),
  jsExpressions: z.array(z.string()).optional(),
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

  const containerRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<{ run: (code: string | Function) => Promise<unknown>; destroy: () => void; iframe: HTMLIFrameElement } | null>(null);
  const sandboxReadyRef = useRef(false);
  const executedIndexRef = useRef(0);
  const pendingQueueRef = useRef<string[]>([]);
  const jsFunctionsInjectedRef = useRef(false);

  // Effect 1 — Sandbox lifecycle (depends on content.html)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !content.html) return;

    let cancelled = false;

    // Reset state for new html
    executedIndexRef.current = 0;
    jsFunctionsInjectedRef.current = false;
    sandboxReadyRef.current = false;
    pendingQueueRef.current = [];

    // Dynamic import to avoid SSR issues (websandbox references `self` at module level)
    const htmlContent = content.html;
    import("@jetbrains/websandbox").then(({ default: WebsandboxModule }) => {
      if (cancelled) return;

      const sandbox = WebsandboxModule.create({}, {
        frameContainer: container,
        frameContent: ensureHead(htmlContent),
      });
      sandboxRef.current = sandbox;

      // Style the iframe to fill container
      sandbox.iframe.style.width = "100%";
      sandbox.iframe.style.height = "100%";
      sandbox.iframe.style.border = "none";
      sandbox.iframe.style.backgroundColor = "transparent";

      // Listen for height updates from the iframe's ResizeObserver
      const onMessage = (e: MessageEvent) => {
        if (e.source === sandbox.iframe.contentWindow && e.data?.type === "__ck_resize") {
          setAutoHeight(e.data.height);
        }
      };
      window.addEventListener("message", onMessage);

      sandbox.promise.then(() => {
        if (cancelled) return;
        sandboxReadyRef.current = true;

        // Inject ResizeObserver to report content height back to parent
        sandbox.run(`
          (function() {
            var ro = new ResizeObserver(function() {
              var h = document.documentElement.scrollHeight;
              parent.postMessage({ type: "__ck_resize", height: h }, "*");
            });
            ro.observe(document.documentElement);
          })();
        `);

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
      if (sandboxRef.current) {
        sandboxRef.current.destroy();
        sandboxRef.current = null;
      }
      sandboxReadyRef.current = false;
      setAutoHeight(null);
    };
  }, [content.html]);

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

  const height = autoHeight ?? initialHeight;

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: `${height}px`,
        borderRadius: "8px",
        backgroundColor: content.html ? "transparent" : "#f5f5f5",
        border: content.html ? "none" : "1px solid #e0e0e0",
        display: content.html ? "block" : "flex",
        alignItems: content.html ? undefined : "center",
        justifyContent: content.html ? undefined : "center",
        overflow: "hidden",
      }}
    >
      {!content.html && (
        <span style={{ color: "#999", fontSize: "14px" }}>
          Generative UI Placeholder
        </span>
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
    }, 3000);
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
