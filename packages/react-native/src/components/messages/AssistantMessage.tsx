import React from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { CopilotMarkdown } from "../Markdown";
import { TypingIndicator } from "./TypingIndicator";
import { formatTimestamp } from "./utils";

// ─── Colors ──────────────────────────────────────────────────────────────────
const ASSISTANT_BUBBLE_BG = "#F0F0F0";
const ASSISTANT_TEXT_COLOR = "#1A1A1A";
const TIMESTAMP_COLOR = "#999999";

/**
 * Props for the AssistantMessage component.
 */
export interface AssistantMessageProps {
  /** Markdown content to render inside the bubble */
  content: string;
  /** When true, shows a typing indicator instead of content */
  isLoading?: boolean;
  /** Optional timestamp displayed below the bubble */
  timestamp?: Date;
  /** Optional style override for the outer container */
  style?: ViewStyle;
}

/**
 * Left-aligned chat bubble for AI assistant responses.
 *
 * Renders markdown content via `CopilotMarkdown` and shows an animated
 * typing indicator when `isLoading` is true.
 */
export function AssistantMessage({
  content,
  isLoading = false,
  timestamp,
  style,
}: AssistantMessageProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.bubble}>
        {content ? <CopilotMarkdown content={content} /> : null}
        {isLoading ? <TypingIndicator /> : null}
      </View>
      {timestamp && (
        <Text style={styles.timestamp}>{formatTimestamp(timestamp)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  bubble: {
    backgroundColor: ASSISTANT_BUBBLE_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "80%",
  },
  timestamp: {
    color: TIMESTAMP_COLOR,
    fontSize: 11,
    marginTop: 2,
    marginLeft: 4,
  },
});
