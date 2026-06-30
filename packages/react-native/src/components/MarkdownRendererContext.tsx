import React, { createContext, useContext } from "react";
import type { MarkdownStyle } from "./Markdown";

export interface NativeMarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

export type NativeMarkdownRenderer =
  React.ComponentType<NativeMarkdownRendererProps>;

/** Config for the built-in RN renderer (pass instead of a component). */
export interface DefaultMarkdownRendererProps {
  style?: MarkdownStyle;
  animate?: boolean;
}
export type MarkdownRendererValue =
  | NativeMarkdownRenderer
  | DefaultMarkdownRendererProps;

/** A component is a function or an object carrying React's `$$typeof` (forwardRef/memo). */
export function isNativeComponentRenderer(
  value: unknown,
): value is NativeMarkdownRenderer {
  if (typeof value === "function") return true;
  return !!value && typeof value === "object" && "$$typeof" in value;
}

const Ctx = createContext<MarkdownRendererValue | undefined>(undefined);

export const MarkdownRendererProvider: React.FC<{
  renderer?: MarkdownRendererValue;
  children: React.ReactNode;
}> = ({ renderer, children }) => (
  <Ctx.Provider value={renderer}>{children}</Ctx.Provider>
);

export function useMarkdownRenderer(): MarkdownRendererValue | undefined {
  return useContext(Ctx);
}
