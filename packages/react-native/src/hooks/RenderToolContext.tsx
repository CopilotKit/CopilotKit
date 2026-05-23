import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

/**
 * Props passed to a render tool function.
 */
export interface RenderToolProps<T = Record<string, unknown>> {
  args: T;
  status: "executing" | "complete";
  result?: string;
}

/**
 * A render function that returns a React Native element for a tool call.
 * Returns `ReactElement | null` (not ReactNode) because React Native's
 * FlatList cannot render strings or portals.
 */
export type RenderToolFunction<T = Record<string, unknown>> = (
  props: RenderToolProps<T>,
) => React.ReactElement | null;

/**
 * The registry maps tool names to their render functions.
 */
export type RenderToolRegistry = Map<string, RenderToolFunction>;

/**
 * Internal store that notifies subscribers when the registry changes.
 * This avoids unnecessary re-renders of the entire tree when a single
 * tool's render function is registered or removed.
 */
interface RegistryStore {
  registry: RenderToolRegistry;
  version: number;
  listeners: Set<() => void>;
}

function createRegistryStore(): RegistryStore {
  return {
    registry: new Map(),
    version: 0,
    listeners: new Set(),
  };
}

function emitChange(store: RegistryStore) {
  store.version++;
  // Create a new Map so useSyncExternalStore detects the reference change
  store.registry = new Map(store.registry);
  for (const listener of store.listeners) {
    listener();
  }
}

interface RenderToolContextValue {
  store: RegistryStore;
  register: (name: string, render: RenderToolFunction) => () => void;
}

const RenderToolCtx = createContext<RenderToolContextValue | null>(null);

/**
 * Provider that maintains the render tool registry.
 * Should be nested inside CopilotKitProvider.
 */
export function RenderToolProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const storeRef = useRef<RegistryStore>(createRegistryStore());

  const register = useCallback(
    (name: string, render: RenderToolFunction): (() => void) => {
      const store = storeRef.current;
      store.registry.set(name, render);
      emitChange(store);

      // Return unregister function
      return () => {
        // Only delete if the current render function is the one we registered
        if (store.registry.get(name) === render) {
          store.registry.delete(name);
          emitChange(store);
        }
      };
    },
    [],
  );

  const value = useMemo<RenderToolContextValue>(
    () => ({ store: storeRef.current, register }),
    [register],
  );

  return (
    <RenderToolCtx.Provider value={value}>{children}</RenderToolCtx.Provider>
  );
}

/**
 * Returns the current render tool registry (a Map of tool name to render function).
 * Re-renders when the registry changes.
 *
 * @throws if called outside of RenderToolProvider
 */
export function useRenderToolRegistry(): RenderToolRegistry {
  const ctx = useContext(RenderToolCtx);
  if (!ctx) {
    throw new Error(
      "useRenderToolRegistry must be used within a RenderToolProvider",
    );
  }

  const { store } = ctx;

  // Subscribe to registry changes via useSyncExternalStore for tear-safe reads
  return useSyncExternalStore(
    (onStoreChange) => {
      store.listeners.add(onStoreChange);
      return () => {
        store.listeners.delete(onStoreChange);
      };
    },
    () => store.registry,
    () => store.registry,
  );
}

/**
 * Internal hook used by useRenderTool to register a render function.
 * Not exported from the package — consumers use useRenderTool instead.
 *
 * @throws if called outside of RenderToolProvider
 */
export function useRenderToolContext() {
  const ctx = useContext(RenderToolCtx);
  if (!ctx) {
    throw new Error(
      "useRenderTool must be used within a RenderToolProvider (inside CopilotKitProvider)",
    );
  }
  return ctx;
}
