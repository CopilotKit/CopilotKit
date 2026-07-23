import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { render } from "@testing-library/vue";
import { useKeyboardHeight, type KeyboardState } from "../use-keyboard-height";

function mountHook() {
  let state: KeyboardState | null = null;
  const Harness = defineComponent({
    setup() {
      state = useKeyboardHeight();
      return () => h("div");
    },
  });
  const result = render(Harness);
  if (!state) {
    throw new Error("Hook harness was not initialized.");
  }
  return { ...result, state: state! };
}

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
    it("returns default state when Visual Viewport API unavailable", async () => {
      Object.defineProperty(window, "visualViewport", {
        value: null,
        writable: true,
        configurable: true,
      });

      const { state } = mountHook();
      await nextTick();

      expect(state.isKeyboardOpen.value).toBe(false);
      expect(state.keyboardHeight.value).toBe(0);
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

    it("detects keyboard open when height diff > 150px", async () => {
      const { state } = mountHook();
      await nextTick();

      expect(state.isKeyboardOpen.value).toBe(false);
      expect(state.keyboardHeight.value).toBe(0);

      mockVisualViewport!.height = 500;
      const resizeListeners = visualViewportListeners.get("resize") || [];
      resizeListeners.forEach((listener) => listener(new Event("resize")));
      await nextTick();

      expect(state.isKeyboardOpen.value).toBe(true);
      expect(state.keyboardHeight.value).toBe(300);
      expect(state.availableHeight.value).toBe(500);
    });

    it("detects keyboard closed when height diff <= 150px", async () => {
      mockVisualViewport!.height = 500;

      const { state } = mountHook();
      await nextTick();

      expect(state.isKeyboardOpen.value).toBe(true);
      expect(state.keyboardHeight.value).toBe(300);

      mockVisualViewport!.height = 800;
      const resizeListeners = visualViewportListeners.get("resize") || [];
      resizeListeners.forEach((listener) => listener(new Event("resize")));
      await nextTick();

      expect(state.isKeyboardOpen.value).toBe(false);
      expect(state.keyboardHeight.value).toBe(0);
    });

    it("updates on visualViewport resize event", async () => {
      const { state } = mountHook();
      await nextTick();

      expect(state.keyboardHeight.value).toBe(0);

      mockVisualViewport!.height = 600;
      let resizeListeners = visualViewportListeners.get("resize") || [];
      resizeListeners.forEach((listener) => listener(new Event("resize")));
      await nextTick();

      expect(state.keyboardHeight.value).toBe(200);
      expect(state.availableHeight.value).toBe(600);

      mockVisualViewport!.height = 400;
      resizeListeners = visualViewportListeners.get("resize") || [];
      resizeListeners.forEach((listener) => listener(new Event("resize")));
      await nextTick();

      expect(state.keyboardHeight.value).toBe(400);
      expect(state.availableHeight.value).toBe(400);
    });

    it("updates on visualViewport scroll event", async () => {
      const { state } = mountHook();
      await nextTick();

      mockVisualViewport!.height = 550;
      const scrollListeners = visualViewportListeners.get("scroll") || [];
      scrollListeners.forEach((listener) => listener(new Event("scroll")));
      await nextTick();

      expect(state.keyboardHeight.value).toBe(250);
      expect(state.availableHeight.value).toBe(550);
    });

    it("cleans up event listeners on unmount", async () => {
      const { unmount } = mountHook();
      await nextTick();

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
