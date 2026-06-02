import React from "react";
import {
  StreamingMarkdownRenderer,
  defaultMarkdownStyles as _streamingDefaultStyles,
} from "@copilotkit/markdown-renderer/react-native";
import type { MarkdownStyle as StreamingMarkdownStyle } from "@copilotkit/markdown-renderer/react-native";

/**
 * Style map for CopilotMarkdown. Each key maps a node type to a React Native
 * style object. Extends the streaming renderer's style keys with a `code`
 * shorthand kept for backward compatibility (`list` already exists on the
 * base style and needs no alias).
 *
 * @public
 */
export type MarkdownStyle = StreamingMarkdownStyle & {
  /** Alias for `inlineCode`; kept for backward compatibility. */
  code?: Record<string, unknown>;
};

/**
 * Default styles that ship with CopilotMarkdown.
 *
 * @public
 */
export const defaultMarkdownStyles: MarkdownStyle = {
  ..._streamingDefaultStyles,
  // Back-compat alias: `code` = same as `inlineCode`
  code: _streamingDefaultStyles.inlineCode,
};

export interface CopilotMarkdownProps {
  content: string;
  style?: MarkdownStyle;
  /**
   * When true, enables `Intl.Segmenter`-based per-token animation inside the
   * streaming renderer. Defaults to `false` (Hermes-safe: no Segmenter needed).
   */
  streamingAnimation?: boolean;
}

/**
 * GFM markdown renderer for React Native. Delegates to the shared
 * `StreamingMarkdownRenderer` from `@copilotkit/markdown-renderer/react-native`.
 *
 * Public API is backward-compatible with the previous basic renderer:
 * - `CopilotMarkdownProps` — same shape.
 * - `MarkdownStyle` / `defaultMarkdownStyles` — same exports.
 * - `streamingAnimation` maps to `animate` (defaults `false` = Hermes-safe).
 *
 * @public
 */
export function CopilotMarkdown({
  content,
  style,
  streamingAnimation = false,
}: CopilotMarkdownProps): React.ReactElement | null {
  // Translate the back-compat `code` alias onto `inlineCode` — the key the
  // streaming renderer actually reads. Without this, a caller migrating from
  // the previous renderer who passes `style={{ code: ... }}` would silently
  // lose inline-code styling. An explicit `inlineCode` wins over the alias.
  let resolvedStyle = style as StreamingMarkdownStyle | undefined;
  if (style?.code !== undefined) {
    const { code, ...rest } = style;
    resolvedStyle = {
      ...(rest as StreamingMarkdownStyle),
      inlineCode: (rest as StreamingMarkdownStyle).inlineCode ?? code,
    };
  }
  return (
    <StreamingMarkdownRenderer
      content={content}
      isComplete={true}
      style={resolvedStyle}
      animate={streamingAnimation}
    />
  );
}
