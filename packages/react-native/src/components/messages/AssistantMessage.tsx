import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";
import { CopilotMarkdown } from "../Markdown";
import { useCopilotTheme } from "../theme";
import { appendStreamingCursor } from "./streaming-cursor";
import { TypingIndicator } from "./TypingIndicator";
import { formatTimestamp } from "./utils";

/**
 * Props for the AssistantMessage component.
 */
export interface AssistantMessageProps {
  /** Markdown content to render */
  content: string;
  /**
   * True while the reply is being written: a cursor rides the end of the text,
   * or pulses on its own until the first words arrive.
   */
  isLoading?: boolean;
  /** Optional timestamp displayed below the message */
  timestamp?: Date;
  /** Optional style override for the outer container */
  style?: ViewStyle;
}

/**
 * An AI assistant reply: full-width markdown on the chat surface, like the
 * web chat (no bubble).
 */
export function AssistantMessage({
  content,
  isLoading = false,
  timestamp,
  style,
}: AssistantMessageProps) {
  const theme = useCopilotTheme();
  // The cursor sits below instead when there's no text yet, or when the last
  // block has no text to follow (a code block).
  const withCursor =
    isLoading && content ? appendStreamingCursor(content) : undefined;
  const cursorBelow = isLoading && !withCursor;

  return (
    <View style={[styles.container, style]}>
      {content ? <CopilotMarkdown content={withCursor ?? content} /> : null}
      {cursorBelow ? <TypingIndicator /> : null}
      {timestamp && (
        <Text style={[styles.timestamp, { color: theme.mutedForeground }]}>
          {formatTimestamp(timestamp)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    marginVertical: 6,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
  },
});
