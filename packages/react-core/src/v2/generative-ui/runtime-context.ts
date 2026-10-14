import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import type { GenerativeUICatalog } from "./catalog";
import type { GenerativeUIDispatcher } from "./dispatcher";
import type { GenerativeUIErrorInfo, GenerativeUIInvokeResult } from "./errors";
import type { GenerativeUISurfaceManager } from "./surface-manager";

export interface GenerativeUIErrorBoundaryConfig {
  /** Replaces the default per-component fallback. */
  fallback?: (props: {
    error: Error;
    retry: () => void;
    surfaceId: string;
    componentId: string;
  }) => ReactNode;
  /** Called for render, props, operation, function and event failures. */
  onError?: (info: GenerativeUIErrorInfo) => void;
}

export interface GenerativeUIRuntime {
  manager: GenerativeUISurfaceManager;
  dispatcher: GenerativeUIDispatcher;
  catalog: GenerativeUICatalog;
  forwardEvent: (
    event: GenerativeUIUserEvent,
    agentId: string | undefined,
  ) => Promise<GenerativeUIInvokeResult>;
  reportError: (info: GenerativeUIErrorInfo) => void;
  readonly errorFallback?: GenerativeUIErrorBoundaryConfig["fallback"];
}

export const GenerativeUIRuntimeContext =
  createContext<GenerativeUIRuntime | null>(null);

export function useGenerativeUIRuntime(): GenerativeUIRuntime | null {
  return useContext(GenerativeUIRuntimeContext);
}

export function useRequiredGenerativeUIRuntime(): GenerativeUIRuntime {
  const runtime = useContext(GenerativeUIRuntimeContext);
  if (!runtime) {
    throw new Error(
      "Generative UI components must be rendered inside <CopilotKit generativeUI={{ catalog }}>.",
    );
  }
  return runtime;
}

/**
 * Reports an error without ever throwing: `reportError` reaches host code
 * (`onError`), and a throwing host callback must not break rendering or an
 * event handler.
 */
export function reportErrorSafely(
  runtime: GenerativeUIRuntime,
  info: GenerativeUIErrorInfo,
): void {
  try {
    runtime.reportError(info);
  } catch {
    // Intentionally swallowed: there is nowhere safe left to report to.
  }
}

export interface GenerativeUINodeContextValue {
  surfaceKey: string;
  surfaceId: string;
  componentId: string;
}

export const GenerativeUINodeContext =
  createContext<GenerativeUINodeContextValue | null>(null);
