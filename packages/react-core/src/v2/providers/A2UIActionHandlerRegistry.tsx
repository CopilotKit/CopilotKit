import { createContext, useContext, useRef, type ReactNode } from "react";
import type { A2UIActionHandler } from "../a2ui/A2UIMessageRenderer";

/**
 * Registry for A2UI action handlers registered via useA2UIActionHandler.
 */
export interface A2UIActionHandlerRegistryValue {
  register: (id: string, handler: A2UIActionHandler) => void;
  unregister: (id: string) => void;
  /** Get all registered handlers in registration order. */
  getHandlers: () => A2UIActionHandler[];
}

const A2UIActionHandlerRegistryContext =
  createContext<A2UIActionHandlerRegistryValue | null>(null);

export function useA2UIActionHandlerRegistry(): A2UIActionHandlerRegistryValue {
  const registry = useContext(A2UIActionHandlerRegistryContext);
  if (!registry) {
    throw new Error(
      "useA2UIActionHandler must be used within a CopilotKitProvider",
    );
  }
  return registry;
}

export function A2UIActionHandlerRegistryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const handlers = useRef(new Map<string, A2UIActionHandler>());

  const registryRef = useRef<A2UIActionHandlerRegistryValue | null>(null);
  if (!registryRef.current) {
    registryRef.current = {
      register: (id, handler) => {
        handlers.current.set(id, handler);
      },
      unregister: (id) => {
        handlers.current.delete(id);
      },
      getHandlers: () => {
        return Array.from(handlers.current.values());
      },
    };
  }

  return (
    <A2UIActionHandlerRegistryContext.Provider value={registryRef.current}>
      {children}
    </A2UIActionHandlerRegistryContext.Provider>
  );
}
