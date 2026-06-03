"use client";

import React from "react";
import {
  StreamingMarkdownRenderer,
  createStreamingMarkdownNodeRenderers,
} from "@copilotkit/markdown-renderer/react";
import type { DefaultMarkdownRendererProps, MarkdownRendererProps } from "../../providers/MarkdownRendererContext";

// Theme code blocks to CopilotKit's readable, theme-aware treatment
// (light/dark safe). Key is "codeBlock" (camelCase) per NODE_TYPE_TO_RENDERER_KEY.
// The code-block AST node is a leaf: its raw source text lives in node.text;
// node.info holds the language/info string (e.g. "ts" from ```ts).
const defaultNodeRenderers = createStreamingMarkdownNodeRenderers({
  codeBlock: ({ node }) => (
    <pre className="cpk:overflow-x-auto cpk:rounded-lg cpk:bg-muted cpk:text-foreground cpk:p-3">
      <code data-code-info={node.info ?? undefined}>{node.text}</code>
    </pre>
  ),
});

/**
 * react-core's built-in default markdown renderer — a thin adapter over
 * `@copilotkit/markdown-renderer`'s streaming renderer. Maps the pluggable
 * renderer contract (`{ content, isStreaming, className }`) onto the streaming
 * renderer for streaming-safe incremental rendering + per-token animation.
 * Still overridable via the slot/provider pluggable interface.
 */
export function StreamingMarkdownDefaultRenderer({
  content,
  isStreaming,
  className,
  nodeRenderers,
  caret,
  options,
  onLinkClick,
  onCitationClick,
}: MarkdownRendererProps & DefaultMarkdownRendererProps) {
  if (!content) return null;
  const mergedNodeRenderers = nodeRenderers
    ? createStreamingMarkdownNodeRenderers({ ...defaultNodeRenderers, ...nodeRenderers })
    : defaultNodeRenderers;
  return (
    <StreamingMarkdownRenderer
      className={className}
      isComplete={!isStreaming}
      caret={caret ?? !!isStreaming}
      nodeRenderers={mergedNodeRenderers}
      options={options}
      onLinkClick={onLinkClick}
      onCitationClick={onCitationClick}
    >
      {content}
    </StreamingMarkdownRenderer>
  );
}

StreamingMarkdownDefaultRenderer.displayName = "StreamingMarkdownDefaultRenderer";
