import { useState, useEffect } from "react";

export interface KeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  availableHeight: number;
  viewportHeight: number;
}

/**
 * Hook to detect mobile keyboard appearance and calculate available viewport height.
 * Uses the Visual Viewport API to track keyboard state on mobile devices.
 *
 * @returns KeyboardState object with keyboard information
 */
export function useKeyboardHeight(): KeyboardState {
  const [keyboardState, setKeyboardState] = useState<KeyboardState>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    availableHeight: typeof window !== "undefined" ? window.innerHeight : 0,
    viewportHeight: typeof window !== "undefined" ? window.innerHeight : 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Check if Visual Viewport API is available
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return;
    }

    const updateKeyboardState = () => {
      const layoutHeight = window.innerHeight;
      const visualHeight = visualViewport.height;

      // Calculate keyboard height (difference between layout and visual viewport)
      const keyboardHeight = Math.max(0, layoutHeight - visualHeight);

      // Keyboard is considered open if the height difference is significant (> 150px)
      const isKeyboardOpen = keyboardHeight > 150;

      setKeyboardState({
        isKeyboardOpen,
        keyboardHeight,
        availableHeight: visualHeight,
        viewportHeight: layoutHeight,
      });
    };

    // Initial state
    updateKeyboardState();

    // Listen for viewport changes
    visualViewport.addEventListener("resize", updateKeyboardState);
    visualViewport.addEventListener("scroll", updateKeyboardState);

    return () => {
      visualViewport.removeEventListener("resize", updateKeyboardState);
      visualViewport.removeEventListener("scroll", updateKeyboardState);
    };
  }, []);

  return keyboardState;
}
