import {
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import {
  GenerativeUINodeContext,
  useRequiredGenerativeUIRuntime,
} from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";

const noopSubscribe = () => () => {};
const zero = () => 0;
// No surface state exists on the server or during hydration.
const undefinedSnapshot = () => undefined;
const APP_STATE_KEY = /^[A-Za-z0-9_-]+$/;

/** Re-renders on any surface-manager change. */
export function useManagerVersion(runtime: GenerativeUIRuntime | null): number {
  return useSyncExternalStore(
    runtime?.manager.subscribe ?? noopSubscribe,
    runtime?.manager.getVersion ?? zero,
    zero,
  );
}

/**
 * Experimental. Mirrors app state into every surface at `/app/<key>`, where
 * generated components can bind to it. Agents can read it but not write it.
 */
export function useGenerativeUIState(key: string, value: unknown): void {
  const runtime = useRequiredGenerativeUIRuntime();
  if (!APP_STATE_KEY.test(key)) {
    throw new Error(
      `useGenerativeUIState: invalid key "${key}" (use letters, digits, _ or -)`,
    );
  }
  const serialized = JSON.stringify(value);
  useEffect(() => {
    runtime.manager.setAppState(key, JSON.parse(serialized ?? "null"));
  }, [runtime, key, serialized]);
  useEffect(() => () => runtime.manager.removeAppState(key), [runtime, key]);
}

/**
 * Experimental. A form field owned by the user once edited: agent updates to
 * `agentValue` are ignored while the field is dirty, until `reset()`. The draft
 * lives in the surface store, so it survives remounts.
 */
export function useGenerativeUIField<T>(
  name: string,
  agentValue: T,
): [T, (value: T) => void, { dirty: boolean; reset: () => void }] {
  const runtime = useRequiredGenerativeUIRuntime();
  const node = useContext(GenerativeUINodeContext);
  if (!node) {
    throw new Error(
      "useGenerativeUIField must be used inside a generative UI catalog component.",
    );
  }
  const { manager } = runtime;
  const field = useSyncExternalStore(
    manager.subscribe,
    () => manager.getField(node.surfaceKey, node.componentId, name),
    undefinedSnapshot,
  );
  const setValue = useCallback(
    (value: T) =>
      manager.setField(node.surfaceKey, node.componentId, name, value),
    [manager, node.surfaceKey, node.componentId, name],
  );
  const reset = useCallback(
    () => manager.resetField(node.surfaceKey, node.componentId, name),
    [manager, node.surfaceKey, node.componentId, name],
  );
  return [
    field ? (field.value as T) : agentValue,
    setValue,
    { dirty: !!field, reset },
  ];
}
