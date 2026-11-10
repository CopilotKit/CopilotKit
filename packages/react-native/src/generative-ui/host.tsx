import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  GenerativeUIAccessibilityWrapperProps,
  GenerativeUIHost,
  GenerativeUINodeFallbackProps,
  GenerativeUISurfaceRootProps,
} from "@copilotkit/react-core/generative-ui/native";

/**
 * A surface needs no box of its own on React Native: the catalog's
 * components lay themselves out. The web theme is a stylesheet of CSS
 * variables, which React Native has no use for. `GenerativeUIProvider` takes
 * no `theme` and drops one that an untyped caller passes, so the `theme` of
 * these props is always undefined, in a custom host too; style the
 * components of your catalog instead.
 */
function NativeSurfaceRoot({ children }: GenerativeUISurfaceRootProps) {
  return <>{children}</>;
}

/** aria-live to React Native's `accessibilityLiveRegion`. */
const LIVE_REGION = {
  off: "none",
  polite: "polite",
  assertive: "assertive",
} as const;

/**
 * Carries the envelope's hidden state and live region to the platform (not
 * its label or description: see below).
 *
 * It is a real native view, on every React Native version the package
 * supports. `display: contents` would keep it out of the layout, but it
 * exists only on React Native 0.77+ with the New Architecture, and even
 * there a contents view is dropped from the native tree, and its
 * accessibility props with it. `collapsable={false}` stops Fabric and the
 * Android view flattener from removing it as a layout-only view for the
 * same reason.
 *
 * Layout: it has no style of its own, and it cannot pass the component's
 * sizing on, because the style of the component's root view is not one of
 * the props it gets. The wrapper, not the component, is the flex item of the
 * parent. A default view is a column that stretches its child across, so
 * the component keeps the parent's width (in a column) and its own height.
 * But a component sized against its parent's main axis loses that size: in
 * a column, `flex: 1`, `flexGrow` or a percentage `height` resolves against
 * the wrapper, which is only as tall as its content, so the component no
 * longer fills the parent; in a row, the same holds for `flex`, `flexGrow`,
 * a percentage `width` and `alignSelf`. A component that must fill its
 * parent applies the envelope itself: give its definition
 * `accessibility: "self"` and spread `useGenerativeUIAccessibility()` on its
 * root view (React Native 0.71+ reads `aria-hidden` and `aria-live`), and
 * the engine draws no wrapper around it. A custom host can also replace
 * this wrapper.
 *
 * Hidden: `accessibilityElementsHidden` hides the subtree from VoiceOver,
 * `importantForAccessibility="no-hide-descendants"` from TalkBack, and
 * `aria-hidden` covers both on React Native 0.71+.
 *
 * Live region: `accessibilityLiveRegion` is Android-only. iOS has no
 * live-region prop, so VoiceOver does not announce updates to the
 * component by itself; a component that must be heard on iOS announces
 * its change with `AccessibilityInfo.announceForAccessibility`.
 *
 * Label and description: the envelope's `aria-label` and
 * `aria-description` are not applied. A label on this wrapper would name
 * nothing on iOS, where a view that is not `accessible` is not an element,
 * and making the wrapper `accessible` would merge the component and every
 * control in it into one element. React Native also has no
 * `aria-description` (its nearest prop is `accessibilityHint`). A component
 * that needs a name or a hint reads them with `accessibility: "self"` and
 * `useGenerativeUIAccessibility()`, and sets `accessibilityLabel` /
 * `aria-label` (React Native 0.71+) and `accessibilityHint` on its own
 * root view. Spread only the props React Native knows: it ignores
 * `aria-description`.
 */
function NativeAccessibilityWrapper({
  attributes,
  children,
}: GenerativeUIAccessibilityWrapperProps) {
  const hidden = attributes["aria-hidden"] === true;
  const live = attributes["aria-live"];
  return (
    <View
      collapsable={false}
      aria-hidden={hidden || undefined}
      accessibilityElementsHidden={hidden || undefined}
      importantForAccessibility={hidden ? "no-hide-descendants" : undefined}
      accessibilityLiveRegion={live ? LIVE_REGION[live] : undefined}
    >
      {children}
    </View>
  );
}

export function NativeNodeFallback({
  message,
  componentId,
  retry,
}: GenerativeUINodeFallbackProps) {
  return (
    <View
      accessibilityRole="alert"
      testID={`generative-ui-error-${componentId}`}
      style={styles.fallback}
    >
      <Text style={styles.fallbackText}>
        Couldn’t display this part: {message}
      </Text>
      {retry ? (
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text style={[styles.fallbackText, styles.retry]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The host elements of a surface on React Native. */
export const nativeGenerativeUIHost: GenerativeUIHost = {
  SurfaceRoot: NativeSurfaceRoot,
  AccessibilityWrapper: NativeAccessibilityWrapper,
  NodeFallback: NativeNodeFallback,
};

const styles = StyleSheet.create({
  fallback: {
    borderWidth: 1,
    borderColor: "#fca5a5",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  fallbackText: { color: "#991b1b", fontSize: 13 },
  retry: { marginTop: 4, textDecorationLine: "underline" },
});
