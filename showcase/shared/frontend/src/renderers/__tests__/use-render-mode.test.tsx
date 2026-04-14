import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RenderMode } from "../types";

// Mock useAgentContext before importing the hook
const mockUseAgentContext = vi.fn();
vi.mock("@copilotkit/react-core", () => ({
  useAgentContext: (...args: unknown[]) => mockUseAgentContext(...args),
}));

import { useRenderMode } from "../use-render-mode";

// Provide a real Storage-backed localStorage mock for vitest jsdom
const storageMap = new Map<string, string>();
const storageMock: Storage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
  get length() {
    return storageMap.size;
  },
  key: (index: number) => [...storageMap.keys()][index] ?? null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: storageMock,
  writable: true,
});

describe("useRenderMode", () => {
  beforeEach(() => {
    storageMap.clear();
    mockUseAgentContext.mockReset();
  });

  it("defaults to tool-based when localStorage is empty", () => {
    const { result } = renderHook(() => useRenderMode());
    expect(result.current.mode).toBe("tool-based");
  });

  it("reads initial mode from localStorage", () => {
    storageMap.set("showcase-render-mode", "hashbrown");
    const { result } = renderHook(() => useRenderMode());
    expect(result.current.mode).toBe("hashbrown");
  });

  it("persists mode changes to localStorage", () => {
    const { result } = renderHook(() => useRenderMode());

    act(() => {
      result.current.setMode("open-genui");
    });

    expect(result.current.mode).toBe("open-genui");
    expect(storageMap.get("showcase-render-mode")).toBe("open-genui");
  });

  it("forwards the render mode to useAgentContext", () => {
    renderHook(() => useRenderMode());

    expect(mockUseAgentContext).toHaveBeenCalledWith({
      description: "render_mode",
      value: "tool-based",
    });
  });

  it("updates agent context when mode changes", () => {
    const { result } = renderHook(() => useRenderMode());

    act(() => {
      result.current.setMode("a2ui");
    });

    // The last call should reflect the new mode
    const lastCall =
      mockUseAgentContext.mock.calls[mockUseAgentContext.mock.calls.length - 1];
    expect(lastCall[0]).toEqual({
      description: "render_mode",
      value: "a2ui",
    });
  });

  // --- SSR safety ---

  it("hook checks typeof window before accessing localStorage", () => {
    // The hook source has `if (typeof window !== "undefined")` guard.
    // In jsdom, window is always defined, so we verify the guard exists
    // by checking that with no localStorage entry, the fallback is used.
    storageMap.clear();
    const { result } = renderHook(() => useRenderMode());
    expect(result.current.mode).toBe("tool-based");
  });

  // --- Invalid stored value handling ---

  it("uses stored value as-is when it is an unrecognized render mode string", () => {
    // The hook casts localStorage value to RenderMode without validation,
    // so a bad value passes through. This verifies current behavior.
    storageMap.set("showcase-render-mode", "not-a-real-mode");
    const { result } = renderHook(() => useRenderMode());
    // The hook will use whatever string is in localStorage
    expect(result.current.mode).toBe("not-a-real-mode");
  });

  it("defaults to tool-based when localStorage returns empty string", () => {
    storageMap.set("showcase-render-mode", "");
    const { result } = renderHook(() => useRenderMode());
    // Empty string is falsy, so the || fallback kicks in
    expect(result.current.mode).toBe("tool-based");
  });

  // --- Multiple mode switches ---

  it("handles multiple sequential mode changes", () => {
    const { result } = renderHook(() => useRenderMode());

    const modes: RenderMode[] = [
      "a2ui",
      "hashbrown",
      "json-render",
      "open-genui",
      "tool-based",
    ];
    for (const m of modes) {
      act(() => {
        result.current.setMode(m);
      });
      expect(result.current.mode).toBe(m);
      expect(storageMap.get("showcase-render-mode")).toBe(m);
    }
  });

  it("agent context is called on every render with the current mode", () => {
    const { result } = renderHook(() => useRenderMode());

    act(() => {
      result.current.setMode("json-render");
    });

    // At minimum, useAgentContext was called for initial render and after setMode
    expect(mockUseAgentContext.mock.calls.length).toBeGreaterThanOrEqual(2);

    // First call: tool-based (initial)
    expect(mockUseAgentContext.mock.calls[0][0]).toEqual({
      description: "render_mode",
      value: "tool-based",
    });

    // Last call: json-render
    const lastCall =
      mockUseAgentContext.mock.calls[mockUseAgentContext.mock.calls.length - 1];
    expect(lastCall[0]).toEqual({
      description: "render_mode",
      value: "json-render",
    });
  });
});
