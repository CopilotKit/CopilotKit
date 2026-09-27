import type {
  CopilotThreadsDrawerProps,
  ModalThreadsDrawerProp,
} from "./types";

/**
 * Resolves a {@link ModalThreadsDrawerProp} to the drawer props to render, or
 * `null` when the drawer is off.
 */
export function resolveModalThreadsDrawerProps(
  threadsDrawer: ModalThreadsDrawerProp | undefined,
): CopilotThreadsDrawerProps | null {
  if (!threadsDrawer) return null;
  return threadsDrawer === true ? {} : threadsDrawer;
}
