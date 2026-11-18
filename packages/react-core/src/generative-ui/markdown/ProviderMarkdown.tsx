"use client";

import React from "react";
import { StreamingMarkdownDefaultRenderer } from "../../components/chat/StreamingMarkdownDefaultRenderer";
import { isReactComponentType } from "../../lib/slots";
import { useMarkdownRenderer } from "../../providers/MarkdownRendererContext";
import type {
  DefaultMarkdownRendererProps,
  MarkdownRendererProps,
} from "../../providers/MarkdownRendererContext";

/**
 * Markdown prose inside generative UI, rendered like the chat text around
 * it: the renderer set on the provider when there is one, else the built-in
 * streaming renderer. Config passed here wins over provider config.
 */
export function ProviderMarkdown({
  content,
  isStreaming,
  className,
  ...config
}: MarkdownRendererProps & DefaultMarkdownRendererProps) {
  const renderer = useMarkdownRenderer();
  if (renderer && isReactComponentType(renderer)) {
    const Renderer = renderer;
    return (
      <Renderer
        content={content}
        isStreaming={isStreaming}
        className={className}
      />
    );
  }
  return (
    <StreamingMarkdownDefaultRenderer
      {...(renderer as DefaultMarkdownRendererProps | undefined)}
      {...config}
      content={content}
      isStreaming={isStreaming}
      className={className}
    />
  );
}
