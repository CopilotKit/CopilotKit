"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";
import {
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  ToolCallStatus,
  ɵOpenGenerativeUIController,
} from "@copilotkit/core";
import type {
  OpenGenerativeUIContent,
  GenerateSandboxedUiArgs,
} from "@copilotkit/core";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";

export type { OpenGenerativeUIContent, GenerateSandboxedUiArgs };

export const OpenGenerativeUIActivityType = OPEN_GENERATIVE_UI_ACTIVITY_TYPE;

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
}) satisfies z.ZodType<OpenGenerativeUIContent>;

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
}) satisfies z.ZodType<GenerateSandboxedUiArgs>;

interface OpenGenerativeUIActivityRendererProps {
  activityType: string;
  content: OpenGenerativeUIContent;
  message: unknown;
  agent: unknown;
}

/**
 * Renders an Open Generative UI activity. The core controller throttles the
 * content and runs the websandbox iframes inside the container div.
 */
export const OpenGenerativeUIActivityRenderer: React.FC<OpenGenerativeUIActivityRendererProps> =
  function OpenGenerativeUIActivityRenderer({ content }) {
    const [controller] = useState(() => {
      const created = new ɵOpenGenerativeUIController();
      created.setContent(content);
      return created;
    });
    const sandboxFunctions = useSandboxFunctions();
    const containerRef = useRef<HTMLDivElement>(null);
    const state = useSyncExternalStore(
      controller.subscribe,
      controller.getState,
      controller.getState,
    );

    useEffect(() => {
      controller.setSandboxFunctions(sandboxFunctions);
    }, [controller, sandboxFunctions]);

    useEffect(() => {
      controller.setContent(content);
    }, [controller, content]);

    useEffect(() => {
      controller.setHost(containerRef.current);
      return () => controller.destroy();
    }, [controller]);

    const hasVisibleSandbox = state.phase !== "placeholder";

    return (
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: `${state.height}px`,
          borderRadius: "8px",
          backgroundColor: hasVisibleSandbox ? "transparent" : "#f5f5f5",
          border: hasVisibleSandbox ? "none" : "1px solid #e0e0e0",
          display: hasVisibleSandbox ? "block" : "flex",
          alignItems: hasVisibleSandbox ? undefined : "center",
          justifyContent: hasVisibleSandbox ? undefined : "center",
          overflow: "hidden",
        }}
      >
        {state.generating && (
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
