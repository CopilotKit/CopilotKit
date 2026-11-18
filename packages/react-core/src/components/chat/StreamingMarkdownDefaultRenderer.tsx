"use client";

import React from "react";
import { StreamingMarkdownRenderer } from "@copilotkit/markdown/react";
import {
  CHAT_MARKDOWN_NODE_CLASS_NAMES,
  warnUnsupportedRichSyntaxOnce,
} from "@copilotkit/markdown";
import type {
  DefaultMarkdownRendererProps,
  MarkdownRendererProps,
} from "../../providers/MarkdownRendererContext";

/**
 * react-core's built-in default markdown renderer — a thin adapter over
 * `@copilotkit/markdown`'s streaming renderer. Maps the pluggable
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
  // Dev-only: nudge upgraders from the bundled Streamdown default when their
  // content needs math/syntax highlighting the built-in renderer doesn't do.
  warnUnsupportedRichSyntaxOnce(content);
  return (
    <StreamingMarkdownRenderer
      className={className}
      isComplete={!isStreaming}
      caret={caret ?? !!isStreaming}
      nodeRenderers={nodeRenderers}
      nodeClassNames={CHAT_MARKDOWN_NODE_CLASS_NAMES}
      options={options}
      onLinkClick={onLinkClick}
      onCitationClick={onCitationClick}
    >
      {content}
    </StreamingMarkdownRenderer>
  );
}

StreamingMarkdownDefaultRenderer.displayName =
  "StreamingMarkdownDefaultRenderer";
