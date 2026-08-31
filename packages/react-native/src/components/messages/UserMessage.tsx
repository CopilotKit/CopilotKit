import React from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { formatTimestamp } from "./utils";

// ─── Colors ──────────────────────────────────────────────────────────────────
const USER_BUBBLE_BG = "#0066CC";
const USER_TEXT_COLOR = "#FFFFFF";
const TIMESTAMP_COLOR = "#999999";

/**
 * Props for the UserMessage component.
 */
export interface UserMessageProps {
  /** Plain text content to display */
  content: string;
  /** Optional timestamp displayed below the bubble */
  timestamp?: Date;
  /** Optional style override for the outer container */
  style?: ViewStyle;
}

/**
 * Right-aligned chat bubble for user messages.
 *
 * Renders plain text (no markdown) with a primary-color background
 * and white text. Optionally displays a subtle timestamp below.
 */
export function UserMessage({ content, timestamp, style }: UserMessageProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{content}</Text>
      </View>
      {timestamp && (
        <Text style={styles.timestamp}>{formatTimestamp(timestamp)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-end",
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  bubble: {
    backgroundColor: USER_BUBBLE_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "80%",
  },
  text: {
    color: USER_TEXT_COLOR,
    fontSize: 16,
    lineHeight: 22,
  },
  timestamp: {
    color: TIMESTAMP_COLOR,
    fontSize: 11,
    marginTop: 2,
    marginRight: 4,
  },
});
