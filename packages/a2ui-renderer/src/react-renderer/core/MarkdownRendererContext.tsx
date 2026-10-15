import { createContext, useContext, type ComponentType } from "react";

/**
 * Renders a markdown string. The host passes its own (CopilotKit passes the
 * chat's Streamdown) through `A2UIProvider`'s `markdownRenderer` prop, so a
 * `Markdown` component inside a surface looks exactly like the chat's prose.
 */
export type A2UIMarkdownRenderer = ComponentType<{ text: string }>;

const MarkdownRendererContext = createContext<A2UIMarkdownRenderer | null>(
  null,
);

export const MarkdownRendererProvider = MarkdownRendererContext.Provider;

/** The host's markdown renderer, or null when none was provided. */
export function useMarkdownRenderer(): A2UIMarkdownRenderer | null {
  return useContext(MarkdownRendererContext);
}
