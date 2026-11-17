/**
 * React Native host components as DOM elements, so the generative UI tests
 * can query them. The layout and accessibility props a native view would
 * receive are written out as data attributes, so the tests can see what
 * reaches the platform.
 *
 * Use it as the factory of `vi.mock("react-native", ...)`. It imports
 * nothing that imports react-native, so the factory cannot recurse.
 */
import React from "react";

const host =
  (tag: string) =>
  ({
    children,
    testID,
    style,
    onPress,
    accessibilityRole,
    collapsable,
    accessibilityElementsHidden,
    importantForAccessibility,
    accessibilityLiveRegion,
    "aria-hidden": ariaHidden,
    "aria-live": ariaLive,
  }: any) =>
    React.createElement(
      tag,
      {
        "data-testid": testID,
        "data-style": JSON.stringify(style ?? null),
        "data-collapsable": JSON.stringify(collapsable),
        "data-accessibility-elements-hidden": JSON.stringify(
          accessibilityElementsHidden,
        ),
        "data-important-for-accessibility": importantForAccessibility,
        "data-accessibility-live-region": accessibilityLiveRegion,
        "data-aria-hidden": JSON.stringify(ariaHidden),
        "data-aria-live": ariaLive,
        role: accessibilityRole,
        onClick: onPress,
      },
      children,
    );

export function createReactNativeMock() {
  return {
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default },
  };
}
