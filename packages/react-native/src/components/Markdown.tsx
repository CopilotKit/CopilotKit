import React, { useMemo } from "react";
import { StreamdownText } from "react-native-streamdown";
import {
  copilotThemes,
  MONO_FONT,
  radius,
  useCopilotTheme,
  withOpacity,
} from "./theme";
import type { CopilotTheme } from "./theme";

/**
 * Style object accepted by `react-native-enriched-markdown` (and therefore
 * `react-native-streamdown`).  Each key targets a markdown element; the
 * available properties vary per element — see the enriched-markdown style
 * reference for the full list.
 */
export type MarkdownStyle = Record<string, Record<string, unknown>>;

/**
 * Props for the CopilotMarkdown component.
 */
export interface CopilotMarkdownProps {
  /** Markdown string to render. */
  content: string;
  /** Optional style overrides merged on top of the defaults. */
  style?: MarkdownStyle;
  /** Whether to enable the streaming fade-in animation (default: true). */
  streamingAnimation?: boolean;
}

/**
 * Markdown styles for one theme, matching the web chat: GitHub-like prose on
 * the design tokens, readable inline code (a 9% foreground tint, visible on any
 * surface) and bordered code blocks.
 */
function markdownStylesFor(theme: CopilotTheme): MarkdownStyle {
  const heading = {
    fontWeight: "600",
    color: theme.foreground,
    marginTop: 20,
    marginBottom: 8,
  };
  return {
    paragraph: {
      fontSize: 16,
      lineHeight: 26,
      color: theme.foreground,
      marginTop: 0,
      marginBottom: 12,
    },
    h1: { ...heading, fontSize: 22, lineHeight: 29 },
    h2: { ...heading, fontSize: 19, lineHeight: 25 },
    h3: { ...heading, fontSize: 17, lineHeight: 23 },
    h4: { ...heading, fontSize: 16, lineHeight: 22 },
    h5: { ...heading, fontSize: 16, lineHeight: 22 },
    h6: {
      ...heading,
      fontSize: 14,
      lineHeight: 20,
      color: theme.mutedForeground,
    },
    strong: {
      fontWeight: "bold",
      color: theme.foreground,
    },
    em: {
      fontStyle: "italic",
    },
    link: {
      color: theme.foreground,
      underline: true,
    },
    blockquote: {
      fontSize: 16,
      lineHeight: 26,
      color: theme.mutedForeground,
      backgroundColor: "transparent",
      borderColor: theme.border,
      borderWidth: 2,
      gapWidth: 14,
      marginBottom: 16,
    },
    code: {
      fontFamily: MONO_FONT,
      fontSize: 14,
      color: theme.foreground,
      backgroundColor: withOpacity(theme.foreground, 0.09),
      borderColor: "transparent",
    },
    codeBlock: {
      fontFamily: MONO_FONT,
      fontSize: 13,
      lineHeight: 21,
      color: theme.foreground,
      backgroundColor: theme.codeBlock,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: radius.xl,
      padding: 14,
      marginTop: 4,
      marginBottom: 16,
    },
    list: {
      fontSize: 16,
      lineHeight: 26,
      color: theme.foreground,
      bulletColor: theme.mutedForeground,
      markerColor: theme.mutedForeground,
      marginTop: 0,
      marginBottom: 12,
    },
    strikethrough: {
      color: theme.mutedForeground,
    },
    thematicBreak: {
      color: theme.border,
      marginTop: 24,
      marginBottom: 24,
    },
    image: {
      borderRadius: radius.lg,
    },
  };
}

/**
 * Default (light) markdown styles tuned for chat display.
 *
 * Exported so consumers can spread and extend:
 * ```ts
 * import { defaultMarkdownStyles } from "@copilotkit/react-native";
 * const custom = { ...defaultMarkdownStyles, h1: { fontSize: 28 } };
 * ```
 */
export const defaultMarkdownStyles: MarkdownStyle = markdownStylesFor(
  copilotThemes.light,
);

/**
 * The same styles on the dark tokens, used with the `"dark"` color scheme.
 * Spread and extend them like `defaultMarkdownStyles`.
 */
export const darkMarkdownStyles: MarkdownStyle = markdownStylesFor(
  copilotThemes.dark,
);

/**
 * Renders markdown content using `react-native-streamdown` with
 * pre-configured styles suited for CopilotKit chat bubbles.
 *
 * `react-native-streamdown` processes incomplete streaming markdown in the
 * background, rendering incrementally without visual glitches — ideal for
 * displaying LLM output as it arrives.
 *
 * Light by default; a `CopilotColorSchemeProvider` (or the enclosing chat's
 * `colorScheme`) switches it to the dark styles. Custom styles are merged on
 * top of the defaults so callers only need to override what they want to
 * change.
 */
export function CopilotMarkdown({
  content,
  style,
  streamingAnimation = true,
}: CopilotMarkdownProps) {
  const theme = useCopilotTheme();
  const baseStyles =
    theme === copilotThemes.dark ? darkMarkdownStyles : defaultMarkdownStyles;
  const mergedStyles = useMemo(() => {
    if (!style) return baseStyles;
    return { ...baseStyles, ...style };
  }, [baseStyles, style]);

  return (
    <StreamdownText
      markdown={content}
      markdownStyle={mergedStyles}
      streamingAnimation={streamingAnimation}
    />
  );
}
