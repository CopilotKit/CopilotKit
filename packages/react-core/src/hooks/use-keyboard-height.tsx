import { useState, useEffect } from "react";
import { ɵinitialKeyboardState, ɵwatchKeyboardState } from "@copilotkit/core";
import type { ɵKeyboardState } from "@copilotkit/core";

export type KeyboardState = ɵKeyboardState;

/**
 * Hook to detect mobile keyboard appearance and calculate available viewport height.
 * Uses the Visual Viewport API to track keyboard state on mobile devices.
 *
 * @returns KeyboardState object with keyboard information
 */
export function useKeyboardHeight(): KeyboardState {
  const [keyboardState, setKeyboardState] = useState(ɵinitialKeyboardState);
  useEffect(() => ɵwatchKeyboardState(setKeyboardState), []);
  return keyboardState;
}
