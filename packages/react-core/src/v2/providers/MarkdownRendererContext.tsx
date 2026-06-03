"use client";

import React, { createContext, useContext } from "react";
import type { StreamingMarkdownRendererProps } from "@copilotkit/markdown-renderer/react";

/** Props every markdown renderer (built-in or plugged-in) receives. */
export interface MarkdownRendererProps {
  /** Raw, possibly-partial (streaming) markdown string. */
  content: string;
  /** Hint that the message is still streaming, for cursor/affordance use. */
  isStreaming?: boolean;
  className?: string;
}

/**
 * Config for the built-in default renderer. Pass this (instead of a component)
 * as `markdownRenderer` to configure the built-in renderer without writing a
 * wrapper — e.g. `markdownRenderer={{ nodeRenderers: { codeBlock: Shiki } }}`.
 */
export type DefaultMarkdownRendererProps = Pick<
  StreamingMarkdownRendererProps,
  "nodeRenderers" | "caret" | "options" | "className" | "onLinkClick" | "onCitationClick"
>;

/** A markdown renderer: a component, OR config for the built-in default. */
export type MarkdownRenderer =
  | React.ComponentType<MarkdownRendererProps>
  | DefaultMarkdownRendererProps;

const MarkdownRendererContext = createContext<MarkdownRenderer | undefined>(
  undefined,
);

export const MarkdownRendererProvider: React.FC<{
  renderer?: MarkdownRenderer;
  children: React.ReactNode;
}> = ({ renderer, children }) => (
  <MarkdownRendererContext.Provider value={renderer}>
    {children}
  </MarkdownRendererContext.Provider>
);

/**
 * The markdown renderer set at the provider level, or `undefined` when none was
 * supplied. Message components fall back to the built-in `BasicMarkdownRenderer`
 * when this is `undefined`.
 */
export function useMarkdownRenderer(): MarkdownRenderer | undefined {
  return useContext(MarkdownRendererContext);
}
