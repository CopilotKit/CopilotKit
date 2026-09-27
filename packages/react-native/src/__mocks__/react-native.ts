/**
 * Stub module for react-native in vitest.
 *
 * The real react-native package uses Flow syntax (`import typeof`) that
 * vite/rollup cannot parse. This stub provides minimal mocks so that
 * modules importing from "react-native" can be resolved during testing.
 * Individual test files can still override with vi.mock("react-native", ...).
 */
import React from "react";

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  hairlineWidth: 1,
};

function createMockComponent(name: string) {
  return React.forwardRef(function MockComponent(props: any, ref: any) {
    return React.createElement(name, { ...props, ref });
  });
}

export const View = createMockComponent("View");
export const Text = createMockComponent("Text");
export const TextInput = createMockComponent("TextInput");
export const TouchableOpacity = createMockComponent("TouchableOpacity");
export const Pressable = createMockComponent("Pressable");
export const FlatList = createMockComponent("FlatList");
export const KeyboardAvoidingView = createMockComponent("KeyboardAvoidingView");
export const ScrollView = createMockComponent("ScrollView");
export const ActivityIndicator = createMockComponent("ActivityIndicator");
export const Image = createMockComponent("Image");

export const Platform = {
  OS: "ios" as const,
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj.ios ?? obj.default,
};

export const useColorScheme = (): "light" | "dark" | null => "light";

export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  addEventListener: () => ({ remove: () => {} }),
};

// Animations don't run in tests: values hold what they're set to, and
// animations are inert handles.
class AnimatedValue {
  constructor(public value: number) {}
  setValue(value: number) {
    this.value = value;
  }
  interpolate(config: { outputRange: unknown[] }) {
    return config.outputRange[0];
  }
}

const inertAnimation = () => ({ start: () => {}, stop: () => {} });

export const Animated = {
  Value: AnimatedValue,
  View: createMockComponent("AnimatedView"),
  Text: createMockComponent("AnimatedText"),
  timing: inertAnimation,
  sequence: inertAnimation,
  parallel: inertAnimation,
  loop: inertAnimation,
  delay: inertAnimation,
};

export const Easing = {
  bezier: () => (t: number) => t,
  linear: (t: number) => t,
};

export default {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
  Image,
  Platform,
  useColorScheme,
  AccessibilityInfo,
  Animated,
  Easing,
};
