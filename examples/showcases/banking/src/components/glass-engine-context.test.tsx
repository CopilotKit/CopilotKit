import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlassEngineProvider, useGlassEngine } from "./glass-engine-context";

const STORAGE_KEY = "northwind.glassEngine";

afterEach(() => window.localStorage.clear());

function makeWrapper(available: boolean) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <GlassEngineProvider available={available}>
        {children}
      </GlassEngineProvider>
    );
  };
}

describe("useGlassEngine", () => {
  it("defaults to disabled when nothing is stored", () => {
    const { result } = renderHook(() => useGlassEngine(), {
      wrapper: makeWrapper(true),
    });
    expect(result.current.enabled).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it("toggle() flips enabled and persists to localStorage", () => {
    const { result } = renderHook(() => useGlassEngine(), {
      wrapper: makeWrapper(true),
    });
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(result.current.active).toBe(true); // available && enabled
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("reads the persisted value on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    const { result } = renderHook(() => useGlassEngine(), {
      wrapper: makeWrapper(true),
    });
    expect(result.current.enabled).toBe(true);
  });

  it("is never active when unavailable, even if localStorage says enabled", () => {
    // The public-host safety property: a forced localStorage value cannot
    // activate the pane when the deployment has not opted in.
    window.localStorage.setItem(STORAGE_KEY, "true");
    const { result } = renderHook(() => useGlassEngine(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.enabled).toBe(true);
    expect(result.current.available).toBe(false);
    expect(result.current.active).toBe(false);
  });
});
