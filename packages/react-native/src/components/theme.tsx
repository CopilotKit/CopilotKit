import React, { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Appearance, Platform } from "react-native";

/**
 * CopilotKit's chat design tokens for React Native: the light and dark values
 * of the web's `globals.css` (`[data-copilotkit]` and `.dark`), as hex. Dark
 * surfaces step up in lightness (background → card → muted), and dark borders
 * are translucent so they sit well on any of them.
 */
export interface CopilotTheme {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  muted: string;
  mutedForeground: string;
  destructive: string;
  border: string;
  input: string;
  /** Code block surface: muted mixed into the background (card in dark). */
  codeBlock: string;
}

const lightTheme: CopilotTheme = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  primary: "#171717",
  primaryForeground: "#fafafa",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  destructive: "#e7000b",
  border: "#e5e5e5",
  input: "#e5e5e5",
  codeBlock: "#fafafa",
};

const darkTheme: CopilotTheme = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  muted: "#262626",
  mutedForeground: "#a1a1a1",
  destructive: "#ff6467",
  border: "rgba(255, 255, 255, 0.1)",
  input: "rgba(255, 255, 255, 0.15)",
  codeBlock: "#171717",
};

export const copilotThemes = { light: lightTheme, dark: darkTheme } as const;

/**
 * The palette CopilotKit's components use: `"light"` (the default), `"dark"`,
 * or `"system"` to follow the device's setting.
 */
export type CopilotColorScheme = "light" | "dark" | "system";

const ColorSchemeContext = createContext<CopilotColorScheme>("light");

/**
 * Sets the color scheme of the CopilotKit components inside it, such as a
 * standalone `AssistantMessage` or `CopilotMarkdown`. The chat components'
 * `colorScheme` prop sets it for everything they render. Leaving `colorScheme`
 * unset keeps the surrounding setting.
 */
export function CopilotColorSchemeProvider({
  colorScheme,
  children,
}: {
  colorScheme?: CopilotColorScheme;
  children: ReactNode;
}) {
  const inherited = useContext(ColorSchemeContext);
  return (
    <ColorSchemeContext.Provider value={colorScheme ?? inherited}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

/**
 * The theme for `colorScheme` or, when it's unset, for the nearest
 * `CopilotColorSchemeProvider` (light without one).
 */
export function useCopilotTheme(
  colorScheme?: CopilotColorScheme,
): CopilotTheme {
  const inherited = useContext(ColorSchemeContext);
  const setting = colorScheme ?? inherited;
  const device = useDeviceColorScheme(setting === "system");
  const dark =
    setting === "dark" || (setting === "system" && device === "dark");
  return dark ? darkTheme : lightTheme;
}

/**
 * The device's color scheme while `follow` is set. Appearance is only read
 * when an app opts into "system", so light/dark-only apps (and test mocks
 * without Appearance) never touch it.
 */
type DeviceColorScheme = ReturnType<typeof Appearance.getColorScheme>;

function useDeviceColorScheme(follow: boolean): DeviceColorScheme {
  const [scheme, setScheme] = useState<DeviceColorScheme>(() =>
    follow ? Appearance.getColorScheme() : null,
  );
  useEffect(() => {
    if (!follow) return;
    setScheme(Appearance.getColorScheme());
    const subscription = Appearance.addChangeListener(({ colorScheme }) =>
      setScheme(colorScheme),
    );
    return () => subscription.remove();
  }, [follow]);
  return follow ? scheme : null;
}

/**
 * `color` (a `#rrggbb` token) at `opacity` — the web's `foreground/10`-style
 * tints.
 */
export function withOpacity(color: string, opacity: number): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Radius scale from the web's `--radius` (10px). */
export const radius = {
  /** Inline code. */
  sm: 6,
  lg: 10,
  /** Code blocks and tool cards. */
  xl: 14,
  /** Suggestion cards, the user bubble and windows. */
  "2xl": 20,
  /** The composer. */
  "3xl": 28,
} as const;

export const MONO_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";
