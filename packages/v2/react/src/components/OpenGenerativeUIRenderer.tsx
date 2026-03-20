"use client";

import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";

export const OpenGenerativeUIActivityType = "open-generative-ui";

export const OpenGenerativeUIContentSchema = z.object({
  height: z.number().optional(),
  html: z.string().optional(),
  js_functions: z.string().optional(),
  js_expressions: z.array(z.string()).optional(),
});

export type OpenGenerativeUIContent = z.infer<
  typeof OpenGenerativeUIContentSchema
>;

interface OpenGenerativeUIRendererProps {
  activityType: string;
  content: OpenGenerativeUIContent;
  message: unknown;
  agent: unknown;
}

function ensureHead(html: string): string {
  if (/<head[\s>]/i.test(html)) return html;
  return `<head></head>${html}`;
}

export const OpenGenerativeUIRenderer: React.FC<
  OpenGenerativeUIRendererProps
> = function OpenGenerativeUIRenderer({ content }) {
  const initialHeight = content.height ?? 200;
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

  // Effect 2 — js_functions injection (depends on content.js_functions)
  useEffect(() => {
    if (!content.js_functions || jsFunctionsInjectedRef.current) return;
    jsFunctionsInjectedRef.current = true;

    const sandbox = sandboxRef.current;
    if (sandboxReadyRef.current && sandbox) {
      sandbox.run(content.js_functions);
    } else {
      pendingQueueRef.current.push(content.js_functions);
    }
  }, [content.js_functions]);

  // Effect 3 — js_expressions execution (depends on content.js_expressions?.length)
  useEffect(() => {
    const expressions = content.js_expressions;
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
  }, [content.js_expressions?.length]);

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
