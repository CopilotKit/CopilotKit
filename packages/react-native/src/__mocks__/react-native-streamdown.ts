/**
 * Fallback module for react-native-streamdown.
 *
 * react-native-streamdown is a peer dependency that isn't installed during
 * monorepo development. This stub satisfies vite's import resolution so
 * that vi.mock() in test files can override it at runtime.
 */
import React from "react";

export function StreamdownText(props: {
  markdown: string;
  markdownStyle?: Record<string, unknown>;
  streamingAnimation?: boolean;
}) {
  return React.createElement("div", null, props.markdown);
}
