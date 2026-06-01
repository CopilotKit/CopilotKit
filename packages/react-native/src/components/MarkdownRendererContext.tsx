import React, { createContext, useContext } from "react";

export interface NativeMarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

export type NativeMarkdownRenderer =
  React.ComponentType<NativeMarkdownRendererProps>;

const Ctx = createContext<NativeMarkdownRenderer | undefined>(undefined);

export const MarkdownRendererProvider: React.FC<{
  renderer?: NativeMarkdownRenderer;
  children: React.ReactNode;
}> = ({ renderer, children }) => (
  <Ctx.Provider value={renderer}>{children}</Ctx.Provider>
);

export function useMarkdownRenderer(): NativeMarkdownRenderer | undefined {
  return useContext(Ctx);
}
