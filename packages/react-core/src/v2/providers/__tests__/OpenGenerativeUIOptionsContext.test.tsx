import { renderHook } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPEN_GEN_UI_OPTIONS,
  OpenGenerativeUIOptionsProvider,
  useOpenGenerativeUIOptions,
} from "../OpenGenerativeUIOptionsContext";

describe("OpenGenerativeUIOptionsContext", () => {
  it("returns DEFAULT_OPEN_GEN_UI_OPTIONS when no provider is present", () => {
    const { result } = renderHook(() => useOpenGenerativeUIOptions());

    expect(result.current).toEqual(DEFAULT_OPEN_GEN_UI_OPTIONS);
  });

  it("returns the provided value when wrapped in OpenGenerativeUIOptionsProvider", () => {
    const { result } = renderHook(() => useOpenGenerativeUIOptions(), {
      wrapper: ({ children }) => (
        <OpenGenerativeUIOptionsProvider
          value={{ designSystemCss: false, importMap: false }}
        >
          {children}
        </OpenGenerativeUIOptionsProvider>
      ),
    });

    expect(result.current.designSystemCss).toBe(false);
    expect(result.current.importMap).toBe(false);
  });
});
