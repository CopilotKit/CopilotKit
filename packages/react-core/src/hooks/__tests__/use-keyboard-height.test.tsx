import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useKeyboardHeight } from "../use-keyboard-height";

describe("useKeyboardHeight", () => {
  let visualViewportListeners: Map<string, ((event: Event) => void)[]>;
  let mockVisualViewport: {
    height: number;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  } | null;
  let originalVisualViewport: VisualViewport | null;
  let originalInnerHeight: number;

  beforeEach(() => {
    visualViewportListeners = new Map();
    originalVisualViewport = window.visualViewport;
    originalInnerHeight = window.innerHeight;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset visualViewport
    Object.defineProperty(window, "visualViewport", {
      value: originalVisualViewport,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: originalInnerHeight,
      writable: true,
      configurable: true,
    });
  });

  describe("Visual Viewport API unavailable", () => {
    it("returns default state when Visual Viewport API unavailable", () => {
      // Mock window without visualViewport
      Object.defineProperty(window, "visualViewport", {
        value: null,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useKeyboardHeight());

      expect(result.current.isKeyboardOpen).toBe(false);
      expect(result.current.keyboardHeight).toBe(0);
    });
  });

  describe("Keyboard detection", () => {
    beforeEach(() => {
      mockVisualViewport = {
        height: 800,
        addEventListener: vi.fn(
          (type: string, listener: (event: Event) => void) => {
            const listeners = visualViewportListeners.get(type) || [];
            listeners.push(listener);
            visualViewportListeners.set(type, listeners);
          },
        ),
        removeEventListener: vi.fn(
          (type: string, listener: (event: Event) => void) => {
            const listeners = visualViewportListeners.get(type) || [];
            const index = listeners.indexOf(listener);
            if (index > -1) {
              listeners.splice(index, 1);
            }
            visualViewportListeners.set(type, listeners);
          },
        ),
      };

      Object.defineProperty(window, "visualViewport", {
        value: mockVisualViewport,
        writable: true,
        configurable: true,
      });

      Object.defineProperty(window, "innerHeight", {
        value: 800,
        writable: true,
        configurable: true,
      });
    });

    it("detects keyboard open when height diff > 150px", () => {
      // Start with keyboard closed
      const { result } = renderHook(() => useKeyboardHeight());

      expect(result.current.isKeyboardOpen).toBe(false);
      expect(result.current.keyboardHeight).toBe(0);

      // Simulate keyboard opening (visual viewport shrinks by 300px)
      act(() => {
        mockVisualViewport!.height = 500;
        const resizeListeners = visualViewportListeners.get("resize") || [];
        resizeListeners.forEach((listener) => listener(new Event("resize")));
      });

      expect(result.current.isKeyboardOpen).toBe(true);
      expect(result.current.keyboardHeight).toBe(300);
      expect(result.current.availableHeight).toBe(500);
    });

    it("detects keyboard closed when height diff <= 150px", () => {
      // Simulate keyboard being open first
      mockVisualViewport!.height = 500;

      const { result } = renderHook(() => useKeyboardHeight());

      expect(result.current.isKeyboardOpen).toBe(true);
      expect(result.current.keyboardHeight).toBe(300);

      // Simulate keyboard closing (visual viewport returns to full height)
      act(() => {
        mockVisualViewport!.height = 800;
        const resizeListeners = visualViewportListeners.get("resize") || [];
        resizeListeners.forEach((listener) => listener(new Event("resize")));
      });

      expect(result.current.isKeyboardOpen).toBe(false);
      expect(result.current.keyboardHeight).toBe(0);
    });

    it("updates on visualViewport resize event", () => {
      const { result } = renderHook(() => useKeyboardHeight());

      // Initial state
      expect(result.current.keyboardHeight).toBe(0);

      // Simulate resize event (keyboard opens partially)
      act(() => {
        mockVisualViewport!.height = 600;
        const resizeListeners = visualViewportListeners.get("resize") || [];
        resizeListeners.forEach((listener) => listener(new Event("resize")));
      });

      expect(result.current.keyboardHeight).toBe(200);
      expect(result.current.availableHeight).toBe(600);

      // Simulate another resize (keyboard opens more)
      act(() => {
        mockVisualViewport!.height = 400;
        const resizeListeners = visualViewportListeners.get("resize") || [];
        resizeListeners.forEach((listener) => listener(new Event("resize")));
      });

      expect(result.current.keyboardHeight).toBe(400);
      expect(result.current.availableHeight).toBe(400);
    });

    it("updates on visualViewport scroll event", () => {
      const { result } = renderHook(() => useKeyboardHeight());

      // Simulate scroll event (which can also trigger on mobile)
      act(() => {
        mockVisualViewport!.height = 550;
        const scrollListeners = visualViewportListeners.get("scroll") || [];
        scrollListeners.forEach((listener) => listener(new Event("scroll")));
      });

      expect(result.current.keyboardHeight).toBe(250);
      expect(result.current.availableHeight).toBe(550);
    });

    it("cleans up event listeners on unmount", () => {
      const { unmount } = renderHook(() => useKeyboardHeight());

      expect(mockVisualViewport!.addEventListener).toHaveBeenCalledWith(
        "resize",
        expect.any(Function),
      );
      expect(mockVisualViewport!.addEventListener).toHaveBeenCalledWith(
        "scroll",
        expect.any(Function),
      );

      unmount();

      expect(mockVisualViewport!.removeEventListener).toHaveBeenCalledWith(
        "resize",
        expect.any(Function),
      );
      expect(mockVisualViewport!.removeEventListener).toHaveBeenCalledWith(
        "scroll",
        expect.any(Function),
      );
    });
  });
});
