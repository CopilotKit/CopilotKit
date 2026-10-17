"use client";
import React, { createContext, useContext } from "react";
import type { Catalog, Theme } from "@copilotkit/a2ui-renderer";
import type { A2UIRecoveryRendererOptions } from "../A2UIRecoveryStates";
import type { A2UIActionInterceptor } from "../A2UIMessageRenderer";

/**
 * How a markdown-mode surface delivers user actions:
 * - "message": as a visible user message (default for markdown mode).
 * - "legacy": through `copilotkit.properties.a2uiAction`, like tool mode.
 */
export type A2UIMarkdownActionMode = "message" | "legacy";

export type A2UIMarkdownConfig = {
  catalog: Catalog<any>;
  catalogId: string;
  theme: Theme;
  loadingComponent?: React.ComponentType;
  recovery?: A2UIRecoveryRendererOptions;
  onAction?: A2UIActionInterceptor;
  actionMode: A2UIMarkdownActionMode;
};

const A2UIMarkdownContext = createContext<A2UIMarkdownConfig | null>(null);

export { A2UIMarkdownContext };

export function A2UIMarkdownProvider({
  value,
  children,
}: {
  value: A2UIMarkdownConfig | null;
  children: React.ReactNode;
}) {
  return (
    <A2UIMarkdownContext.Provider value={value}>
      {children}
    </A2UIMarkdownContext.Provider>
  );
}

/** Returns the markdown-mode config, or null when the provider is in tool mode. */
export function useA2UIMarkdownConfig(): A2UIMarkdownConfig | null {
  return useContext(A2UIMarkdownContext);
}
