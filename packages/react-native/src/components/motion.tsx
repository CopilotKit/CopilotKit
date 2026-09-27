import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * Whether the user asked the OS to reduce motion. `undefined` until the first
 * answer arrives (the query is async), so an entrance can wait instead of
 * flashing its content first. Only asks while `enabled`, i.e. while an
 * animation could play.
 */
export function useReducedMotion(enabled = true): boolean | undefined {
  const [reduced, setReduced] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const settle = (value: boolean) => {
      if (active) setReduced(value);
    };
    AccessibilityInfo.isReduceMotionEnabled().then(settle, () => settle(false));
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [enabled]);

  return reduced;
}

// Easing curves are made when an animation starts rather than at import, so
// this module loads under react-native mocks that don't provide `Easing`.

/**
 * A value that eases 0 → 1 → 0 once per `cycleMs` while `active`, and rests at
 * 0 otherwise or when the user prefers reduced motion.
 */
export function usePulse(cycleMs: number, active = true): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion(active);
  const run = active && reducedMotion === false;

  useEffect(() => {
    if (!run) {
      value.setValue(0);
      return;
    }
    const half = {
      duration: cycleMs / 2,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    };
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, ...half }),
        Animated.timing(value, { toValue: 0, ...half }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [run, cycleMs, value]);

  return value;
}

/**
 * The welcome screen's entrance: `"play"` rises the content into place,
 * `"pending"` holds it hidden while the reduced-motion setting is read, and
 * `"off"` shows it as is.
 */
export type IntroMode = "play" | "pending" | "off";

const INTRO_DURATION_MS = 480;
const INTRO_RISE = 6;

/** Intro delays: greeting first, suggestion cards staggered, input last. */
export const introDelay = {
  greeting: 0,
  card: (index: number) => 70 + 30 * Math.min(index, 3),
  input: 180,
};

export function IntroRise({
  mode,
  delay = 0,
  style,
  children,
}: {
  mode: IntroMode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(mode === "off" ? 1 : 0)).current;

  useEffect(() => {
    progress.setValue(mode === "off" ? 1 : 0);
    if (mode !== "play") return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: INTRO_DURATION_MS,
      delay,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [mode, delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [INTRO_RISE, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
