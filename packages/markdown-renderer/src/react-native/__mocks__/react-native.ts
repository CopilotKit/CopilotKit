/**
 * Minimal react-native stub for vitest in the markdown-renderer package.
 *
 * The real react-native package uses Flow syntax that vite/rollup cannot parse.
 * This stub allows import analysis to succeed. Individual tests override it via
 * vi.mock("react-native", ...).
 */
import React from "react";

function createMockComponent(name: string) {
  return React.forwardRef(function MockComponent(props: any, ref: any) {
    return React.createElement(name, { ...props, ref });
  });
}

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: <T>(style: T): T => style,
  hairlineWidth: 1,
};

export const View = createMockComponent("View");
export const Text = createMockComponent("Text");

export const Platform = {
  OS: "ios" as const,
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj.ios ?? obj.default,
};

export default {
  StyleSheet,
  View,
  Text,
  Platform,
};
