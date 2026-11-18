"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  ToolCallStatus,
  ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA,
  ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA,
  ɵOpenGenerativeUIController,
  ɵPlaceholderCycler,
} from "@copilotkit/core";
import type {
  OpenGenerativeUIContent,
  GenerateSandboxedUiArgs,
} from "@copilotkit/core";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";

export type { OpenGenerativeUIContent, GenerateSandboxedUiArgs };

export const OpenGenerativeUIActivityType = OPEN_GENERATIVE_UI_ACTIVITY_TYPE;

/** Validates Open Generative UI activity content (shared with Vue and Angular). */
export const OpenGenerativeUIContentSchema = ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA;

/**
 * Schema for the generateSandboxedUi tool call arguments (shared with Vue and
 * Angular). It also describes the arguments to the model as JSON Schema.
 */
export const GenerateSandboxedUiArgsSchema = ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA;

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
        {state.showOverlay && (
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
            {state.showSpinner && (
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                style={{ animation: "ck-spin 1s linear infinite" }}
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="#e0e0e0"
                  strokeWidth="3"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="#999"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            )}
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
  const [cycler] = useState(() => new ɵPlaceholderCycler());
  const { message } = useSyncExternalStore(
    cycler.subscribe,
    cycler.getSnapshot,
    cycler.getSnapshot,
  );
  const isComplete = props.status === ToolCallStatus.Complete;

  useEffect(() => {
    cycler.update(props.args.placeholderMessages, isComplete);
  }, [cycler, props.args.placeholderMessages, isComplete]);
  useEffect(() => () => cycler.dispose(), [cycler]);

  // Before the first effect, show what the cycler starts with: the newest message.
  const shown =
    message ??
    (isComplete ? undefined : props.args.placeholderMessages?.at(-1));
  // Nothing once complete — the activity renderer handles the UI.
  if (shown === undefined) return null;

  return (
    <div
      style={{
        padding: "8px 12px",
        color: "#999",
        fontSize: "14px",
      }}
    >
      {shown}
    </div>
  );
};
