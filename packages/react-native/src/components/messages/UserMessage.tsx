import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";
import { CopilotMarkdown, defaultMarkdownStyles } from "../Markdown";
import type { MarkdownStyle } from "../Markdown";
import { formatTimestamp } from "./utils";

// ─── Colors ──────────────────────────────────────────────────────────────────
const USER_BUBBLE_BG = "#0066CC";
const USER_TEXT_COLOR = "#FFFFFF";
const TIMESTAMP_COLOR = "#999999";

const userMarkdownStyles: MarkdownStyle = {
  paragraph: {
    color: USER_TEXT_COLOR,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 0,
    marginBottom: 0,
  },
  h1: {
    ...defaultMarkdownStyles.h1,
    color: USER_TEXT_COLOR,
  },
  h2: {
    ...defaultMarkdownStyles.h2,
    color: USER_TEXT_COLOR,
  },
  h3: {
    ...defaultMarkdownStyles.h3,
    color: USER_TEXT_COLOR,
  },
  h4: {
    color: USER_TEXT_COLOR,
  },
  h5: {
    color: USER_TEXT_COLOR,
  },
  h6: {
    color: USER_TEXT_COLOR,
  },
  link: {
    color: USER_TEXT_COLOR,
    underline: true,
  },
  list: {
    color: USER_TEXT_COLOR,
    bulletColor: USER_TEXT_COLOR,
    markerColor: USER_TEXT_COLOR,
    marginTop: 4,
    marginBottom: 4,
  },
  code: {
    ...defaultMarkdownStyles.code,
    color: USER_TEXT_COLOR,
    backgroundColor: "#004C99",
  },
};

/**
 * Props for the UserMessage component.
 */
export interface UserMessageProps {
  /** Markdown content to display */
  content: string;
  /** Optional timestamp displayed below the bubble */
  timestamp?: Date;
  /** Optional style override for the outer container */
  style?: ViewStyle;
}

/**
 * Right-aligned chat bubble for user messages.
 *
 * Renders markdown with a primary-color background and white text.
 * Optionally displays a subtle timestamp below.
 */
export function UserMessage({ content, timestamp, style }: UserMessageProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.bubble}>
        <CopilotMarkdown
          content={content}
          style={userMarkdownStyles}
          streamingAnimation={false}
        />
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
  timestamp: {
    color: TIMESTAMP_COLOR,
    fontSize: 11,
    marginTop: 2,
    marginRight: 4,
  },
});
