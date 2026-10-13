import React from "react";
import { View, Animated, StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";
import { usePulse } from "../motion";
import { useCopilotTheme } from "../theme";

/**
 * Props for the TypingIndicator component.
 */
export interface TypingIndicatorProps {
  /** Optional style override for the container */
  style?: ViewStyle;
}

const DOT_SIZE = 11;
const PULSE_CYCLE_MS = 900;

/**
 * The streaming cursor on its own: a dot that pulses while the assistant is
 * working but hasn't written any text yet (once it has, the cursor rides the
 * end of the text instead). Holds still when the user prefers reduced motion.
 *
 * Uses React Native's built-in `Animated` API (no Reanimated dependency).
 */
export function TypingIndicator({ style }: TypingIndicatorProps) {
  const theme = useCopilotTheme();
  const pulse = usePulse(PULSE_CYCLE_MS);

  return (
    <View
      testID="copilot-loading-cursor"
      style={[styles.container, style]}
      accessibilityLabel="Typing indicator"
      accessibilityRole="text"
    >
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: theme.foreground,
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.8],
            }),
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.5],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
