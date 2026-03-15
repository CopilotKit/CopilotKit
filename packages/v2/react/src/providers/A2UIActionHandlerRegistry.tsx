import { createContext, useContext, useRef, type ReactNode } from "react";
import type { A2UIActionHandlerRegistration } from "../hooks/use-a2ui-action-handler";
import type {
  A2UIUserAction,
  A2UIDeclaredOps,
} from "../a2ui/A2UIMessageRenderer";

/**
 * Registry for A2UI action handlers registered via useA2UIActionHandler.
 */
export interface A2UIActionHandlerRegistryValue {
  register: (id: string, registration: A2UIActionHandlerRegistration) => void;
  unregister: (id: string) => void;
  /**
   * Get all registered handlers as an array of handler functions.
   * Each function checks if the action name matches and calls the handler.
   */
  getHandlers: () => Array<
    (
      action: A2UIUserAction,
    ) => Array<Record<string, unknown>> | null | undefined | void
  >;
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
  const registrations = useRef(
    new Map<string, A2UIActionHandlerRegistration>(),
  );

  const registryRef = useRef<A2UIActionHandlerRegistryValue | null>(null);
  if (!registryRef.current) {
    registryRef.current = {
      register: (id, registration) => {
        registrations.current.set(id, registration);
      },
      unregister: (id) => {
        registrations.current.delete(id);
      },
      getHandlers: () => {
        return Array.from(registrations.current.values()).map(
          (reg) => (action: A2UIUserAction, declaredOps: A2UIDeclaredOps) => {
            if (action.name === reg.actionName) {
              return reg.handler(action, declaredOps);
            }
            return null;
          },
        );
      },
    };
  }

  return (
    <A2UIActionHandlerRegistryContext.Provider value={registryRef.current}>
      {children}
    </A2UIActionHandlerRegistryContext.Provider>
  );
}
