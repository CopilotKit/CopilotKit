import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { parseMarkdown } from "@copilotkit/core";
import type { MarkdownToken } from "@copilotkit/core";

export type MarkdownStyle = Record<string, Record<string, unknown>>;

export interface CopilotMarkdownProps {
  content: string;
  style?: MarkdownStyle;
  /** Retained for API compatibility; the basic renderer does not animate. */
  streamingAnimation?: boolean;
}

export const defaultMarkdownStyles: MarkdownStyle = {
  paragraph: { fontSize: 16, lineHeight: 24, color: "#1a1a1a", marginTop: 4, marginBottom: 4 },
  h1: { fontSize: 24, fontWeight: "bold", marginTop: 12, marginBottom: 8, color: "#111111" },
  h2: { fontSize: 20, fontWeight: "bold", marginTop: 10, marginBottom: 6, color: "#111111" },
  h3: { fontSize: 18, fontWeight: "600", marginTop: 8, marginBottom: 4, color: "#222222" },
  strong: { fontWeight: "bold" },
  em: { fontStyle: "italic" },
  link: { color: "#0066cc", textDecorationLine: "underline" },
  blockquote: { backgroundColor: "#f5f5f5", borderLeftWidth: 4, borderLeftColor: "#cccccc", paddingLeft: 12, marginVertical: 4 },
  code: { backgroundColor: "#f0f0f0", fontFamily: "monospace", fontSize: 14 },
  codeBlock: { backgroundColor: "#f0f0f0", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 14, marginVertical: 4 },
  list: { marginTop: 4, marginBottom: 4 },
};

function inlineText(
  tokens: MarkdownToken[] | undefined,
  s: MarkdownStyle,
): React.ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    switch (t.type) {
      case "text":
        return "tokens" in t && (t as any).tokens
          ? inlineText((t as any).tokens, s)
          : (t as any).text;
      case "strong":
        return <Text key={i} style={s.strong}>{inlineText((t as any).tokens, s)}</Text>;
      case "em":
        return <Text key={i} style={s.em}>{inlineText((t as any).tokens, s)}</Text>;
      case "del":
        return <Text key={i} style={{ textDecorationLine: "line-through" }}>{inlineText((t as any).tokens, s)}</Text>;
      case "codespan":
        return <Text key={i} style={s.code}>{(t as any).text}</Text>;
      case "link":
        return <Text key={i} style={s.link}>{(t as any).tokens ? inlineText((t as any).tokens, s) : (t as any).text}</Text>;
      case "escape":
        return (t as any).text;
      default:
        return "text" in t ? (t as any).text : null;
    }
  });
}

function Block({ token, s }: { token: MarkdownToken; s: MarkdownStyle }): React.ReactElement | null {
  switch (token.type) {
    case "space":
      return null;
    case "heading": {
      const depth = (token as any).depth as number;
      const style = s[`h${Math.min(depth, 3)}`] ?? s.h3;
      return <Text style={style}>{inlineText((token as any).tokens, s)}</Text>;
    }
    case "paragraph":
      return <Text style={s.paragraph}>{inlineText((token as any).tokens, s)}</Text>;
    case "blockquote":
      return (
        <View style={s.blockquote}>
          {(((token as any).tokens as MarkdownToken[] | undefined) ?? []).map((t, i) => (
            <Block key={i} token={t} s={s} />
          ))}
        </View>
      );
    case "code":
      return (
        <View style={s.codeBlock}>
          <Text style={s.code}>{(token as any).text}</Text>
        </View>
      );
    case "list":
      return (
        <View style={s.list}>
          {(((token as any).items as Array<{ tokens?: MarkdownToken[] }>) ?? []).map((item, i) => (
            <View key={i} style={{ flexDirection: "row" }}>
              <Text style={s.paragraph}>{(token as any).ordered ? `${i + 1}. ` : "• "}</Text>
              <View style={{ flex: 1 }}>
                {(item.tokens ?? []).map((t, j) => (
                  <Block key={j} token={t} s={s} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case "text":
      return <Text style={s.paragraph}>{(token as any).tokens ? inlineText((token as any).tokens, s) : (token as any).text}</Text>;
    default:
      return "text" in token ? <Text style={s.paragraph}>{(token as any).text}</Text> : null;
  }
}

/**
 * Basic-GFM markdown renderer for React Native. Walks the framework-agnostic
 * token tree from `@copilotkit/core` into `<Text>`/`<View>`. No syntax
 * highlighting/math/tables-with-actions — plug in a custom renderer for those.
 */
export function CopilotMarkdown({ content, style }: CopilotMarkdownProps) {
  const mergedStyles = useMemo(
    () => (style ? { ...defaultMarkdownStyles, ...style } : defaultMarkdownStyles),
    [style],
  );
  const tokens = useMemo(() => parseMarkdown(content ?? ""), [content]);
  return (
    <View>
      {tokens.map((t, i) => (
        <Block key={i} token={t} s={mergedStyles} />
      ))}
    </View>
  );
}
