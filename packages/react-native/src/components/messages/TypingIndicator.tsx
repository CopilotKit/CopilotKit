import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";

/**
 * Props for the TypingIndicator component.
 */
export interface TypingIndicatorProps {
  /** Optional style override for the container */
  style?: ViewStyle;
}

const DOT_SIZE = 6;
const DOT_SPACING = 4;
const ANIMATION_DURATION = 400;

/**
 * Three animated dots that pulse in sequence, suitable for embedding
 * inside an AssistantMessage to indicate the AI is still generating.
 *
 * Uses React Native's built-in `Animated` API (no Reanimated dependency).
 */
export function TypingIndicator({ style }: TypingIndicatorProps) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createPulse = (dot: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: ANIMATION_DURATION,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: ANIMATION_DURATION,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]);

    const animation = Animated.parallel([
      createPulse(dot1, 0),
      createPulse(dot2, ANIMATION_DURATION * 0.33),
      createPulse(dot3, ANIMATION_DURATION * 0.66),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [dot1, dot2, dot3]);

  const dotStyle = (animatedValue: Animated.Value) => ({
    ...styles.dot,
    opacity: animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    }),
    transform: [
      {
        scale: animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0.8, 1.2],
        }),
      },
    ],
  });

  return (
    <View
      testID="copilot-loading-cursor"
      style={[styles.container, style]}
      accessibilityLabel="Typing indicator"
      accessibilityRole="text"
    >
      <Animated.View style={dotStyle(dot1)} />
      <Animated.View style={dotStyle(dot2)} />
      <Animated.View style={dotStyle(dot3)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: "#999999",
    marginHorizontal: DOT_SPACING / 2,
  },
});
