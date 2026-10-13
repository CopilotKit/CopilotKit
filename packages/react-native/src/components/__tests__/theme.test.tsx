import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  onChange: undefined as
    | ((event: { colorScheme: "light" | "dark" | null }) => void)
    | undefined,
  deviceScheme: "dark" as "light" | "dark" | null,
}));

vi.mock("react-native", async () => ({
  ...(await vi.importActual<any>("../../__mocks__/react-native")),
  Appearance: {
    getColorScheme: () => hoisted.deviceScheme,
    addChangeListener: (
      listener: (event: { colorScheme: "light" | "dark" | null }) => void,
    ) => {
      hoisted.onChange = listener;
      return { remove: () => {} };
    },
  },
}));

import {
  CopilotColorSchemeProvider,
  copilotThemes,
  useCopilotTheme,
} from "../theme";
import type { CopilotColorScheme } from "../theme";

const inside =
  (colorScheme: CopilotColorScheme | undefined) =>
  ({ children }: { children: React.ReactNode }) => (
    <CopilotColorSchemeProvider colorScheme={colorScheme}>
      {children}
    </CopilotColorSchemeProvider>
  );

describe("useCopilotTheme", () => {
  beforeEach(() => {
    hoisted.deviceScheme = "dark";
  });

  it("is light by default, even when the device is dark", () => {
    const { result } = renderHook(() => useCopilotTheme());
    expect(result.current).toBe(copilotThemes.light);
  });

  it("uses the scheme passed to it", () => {
    const { result } = renderHook(() => useCopilotTheme("dark"));
    expect(result.current).toBe(copilotThemes.dark);
  });

  it("follows the device with the system scheme", () => {
    const { result } = renderHook(() => useCopilotTheme("system"));
    expect(result.current).toBe(copilotThemes.dark);

    act(() => hoisted.onChange?.({ colorScheme: "light" }));
    expect(result.current).toBe(copilotThemes.light);
  });

  it("reads the nearest provider's scheme", () => {
    const { result } = renderHook(() => useCopilotTheme(), {
      wrapper: inside("dark"),
    });
    expect(result.current).toBe(copilotThemes.dark);
  });

  it("prefers the scheme passed to it over the provider's", () => {
    const { result } = renderHook(() => useCopilotTheme("light"), {
      wrapper: inside("dark"),
    });
    expect(result.current).toBe(copilotThemes.light);
  });

  it("keeps the surrounding scheme under a provider without one", () => {
    const Outer = inside("dark");
    const Inner = inside(undefined);
    const { result } = renderHook(() => useCopilotTheme(), {
      wrapper: ({ children }) => (
        <Outer>
          <Inner>{children}</Inner>
        </Outer>
      ),
    });
    expect(result.current).toBe(copilotThemes.dark);
  });
});
