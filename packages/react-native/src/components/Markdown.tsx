import type { CSSProperties } from "react";
import React, { lazy, Suspense, useMemo } from "react";
import type { Components } from "react-markdown";
import { Platform } from "react-native";
import { StreamdownText } from "react-native-streamdown";

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
 * Default markdown styles tuned for chat bubble display.
 *
 * Exported so consumers can spread and extend:
 * ```ts
 * import { defaultMarkdownStyles } from "@copilotkit/react-native";
 * const custom = { ...defaultMarkdownStyles, h1: { fontSize: 28 } };
 * ```
 */
export const defaultMarkdownStyles: MarkdownStyle = {
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    color: "#1a1a1a",
    marginTop: 4,
    marginBottom: 4,
  },
  h1: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 8,
    color: "#111111",
  },
  h2: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 6,
    color: "#111111",
  },
  h3: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
    color: "#222222",
  },
  strong: {
    fontWeight: "bold",
  },
  em: {
    fontStyle: "italic",
  },
  link: {
    color: "#0066cc",
    underline: true,
  },
  blockquote: {
    backgroundColor: "#f5f5f5",
    borderWidth: 4,
    borderColor: "#cccccc",
    gapWidth: 12,
  },
  code: {
    backgroundColor: "#f0f0f0",
    fontFamily: "monospace",
    fontSize: 14,
  },
  codeBlock: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 12,
    fontFamily: "monospace",
    fontSize: 14,
  },
  list: {
    marginTop: 4,
    marginBottom: 4,
  },
};

interface WebMarkdownProps {
  components: Components;
  content: string;
}

const WebMarkdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] =
    await Promise.all([import("react-markdown"), import("remark-gfm")]);

  return {
    default: ({ components, content }: WebMarkdownProps) => (
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    ),
  };
});

function toWebStyle(
  style: Record<string, unknown> | undefined,
): CSSProperties | undefined {
  if (!style) return undefined;
  const {
    underline,
    bulletColor: _bulletColor,
    markerColor: _markerColor,
    gapWidth,
    borderWidth,
    ...cssStyle
  } = style;
  return {
    ...cssStyle,
    ...(borderWidth !== undefined ? { borderStyle: "solid", borderWidth } : {}),
    ...(underline ? { textDecorationLine: "underline" } : {}),
    ...(gapWidth !== undefined ? { paddingLeft: gapWidth } : {}),
  } as CSSProperties;
}

/**
 * Renders markdown content using `react-native-streamdown` with
 * pre-configured styles suited for CopilotKit chat bubbles.
 *
 * `react-native-streamdown` processes incomplete streaming markdown in the
 * background, rendering incrementally without visual glitches — ideal for
 * displaying LLM output as it arrives.
 *
 * Custom styles are merged on top of the defaults so callers only need
 * to override what they want to change.
 */
export function CopilotMarkdown({
  content,
  style,
  streamingAnimation = true,
}: CopilotMarkdownProps) {
  const mergedStyles = useMemo(() => {
    if (!style) return defaultMarkdownStyles;
    return { ...defaultMarkdownStyles, ...style };
  }, [style]);

  const webComponents = useMemo<Components>(
    () => ({
      p: ({ node: _node, ...props }) => (
        <p
          {...props}
          style={{
            ...toWebStyle(mergedStyles.paragraph),
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          }}
        />
      ),
      h1: ({ node: _node, ...props }) => (
        <h1 {...props} style={toWebStyle(mergedStyles.h1)} />
      ),
      h2: ({ node: _node, ...props }) => (
        <h2 {...props} style={toWebStyle(mergedStyles.h2)} />
      ),
      h3: ({ node: _node, ...props }) => (
        <h3 {...props} style={toWebStyle(mergedStyles.h3)} />
      ),
      h4: ({ node: _node, ...props }) => (
        <h4 {...props} style={toWebStyle(mergedStyles.h4)} />
      ),
      h5: ({ node: _node, ...props }) => (
        <h5 {...props} style={toWebStyle(mergedStyles.h5)} />
      ),
      h6: ({ node: _node, ...props }) => (
        <h6 {...props} style={toWebStyle(mergedStyles.h6)} />
      ),
      a: ({ node: _node, ...props }) => (
        <a
          {...props}
          style={toWebStyle(mergedStyles.link)}
          target="_blank"
          rel="noopener noreferrer"
        />
      ),
      blockquote: ({ node: _node, ...props }) => (
        <blockquote {...props} style={toWebStyle(mergedStyles.blockquote)} />
      ),
      ul: ({ node: _node, ...props }) => (
        <ul {...props} style={toWebStyle(mergedStyles.list)} />
      ),
      ol: ({ node: _node, ...props }) => (
        <ol {...props} style={toWebStyle(mergedStyles.list)} />
      ),
      li: ({ node: _node, ...props }) => (
        <li {...props} style={toWebStyle(mergedStyles.list)} />
      ),
      strong: ({ node: _node, ...props }) => (
        <strong {...props} style={toWebStyle(mergedStyles.strong)} />
      ),
      em: ({ node: _node, ...props }) => (
        <em {...props} style={toWebStyle(mergedStyles.em)} />
      ),
      code: ({ node: _node, ...props }) => (
        <code {...props} style={toWebStyle(mergedStyles.code)} />
      ),
      pre: ({ node: _node, ...props }) => (
        <pre
          {...props}
          style={{
            ...toWebStyle(mergedStyles.codeBlock),
            boxSizing: "border-box",
            maxWidth: "100%",
            overflowX: "auto",
          }}
        />
      ),
      table: ({ node: _node, ...props }) => (
        <div style={{ maxWidth: "100%", overflowX: "auto" }}>
          <table
            {...props}
            style={{
              ...toWebStyle(mergedStyles.paragraph),
              borderCollapse: "collapse",
              width: "100%",
            }}
          />
        </div>
      ),
      th: ({ node: _node, ...props }) => (
        <th
          {...props}
          style={{
            border: "1px solid currentColor",
            padding: "4px 8px",
            textAlign: "left",
          }}
        />
      ),
      td: ({ node: _node, ...props }) => (
        <td
          {...props}
          style={{
            border: "1px solid currentColor",
            padding: "4px 8px",
          }}
        />
      ),
      img: ({ node: _node, ...props }) => (
        // oxlint-disable-next-line next/no-img-element -- React Native Web needs a DOM image renderer.
        <img
          {...props}
          style={{
            display: "block",
            height: "auto",
            maxWidth: "100%",
          }}
        />
      ),
    }),
    [mergedStyles],
  );

  if (Platform.OS === "web") {
    return (
      <Suspense
        fallback={
          <span
            style={{
              ...toWebStyle(mergedStyles.paragraph),
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            {content}
          </span>
        }
      >
        <WebMarkdown components={webComponents} content={content} />
      </Suspense>
    );
  }

  return (
    <StreamdownText
      markdown={content}
      markdownStyle={mergedStyles}
      streamingAnimation={streamingAnimation}
    />
  );
}
