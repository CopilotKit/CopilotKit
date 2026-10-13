import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";
import { radius, useCopilotTheme } from "../theme";
import { formatTimestamp } from "./utils";

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
 * Renders plain text (no markdown), keeping line breaks as typed, on a muted
 * bubble. Optionally displays a subtle timestamp below.
 */
export function UserMessage({ content, timestamp, style }: UserMessageProps) {
  const theme = useCopilotTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.bubble, { backgroundColor: theme.muted }]}>
        <Text style={[styles.text, { color: theme.foreground }]}>
          {content}
        </Text>
      </View>
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
    alignItems: "flex-end",
    paddingTop: 24,
    paddingBottom: 12,
  },
  bubble: {
    borderRadius: radius["2xl"],
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxWidth: "80%",
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 4,
  },
});
