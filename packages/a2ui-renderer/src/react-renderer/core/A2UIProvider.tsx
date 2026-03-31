import {
  createContext,
  useContext,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "../a2ui-react";
import type { A2UIContextValue, A2UIActions } from "./store";
import { ThemeProvider } from "../theme/ThemeContext";
import type { OnActionCallback } from "../types";
import type { A2UIClientEventMessage, Theme } from "../../a2ui-types";

/**
 * Context for stable actions (never changes reference, prevents re-renders).
 */
const A2UIActionsContext = createContext<A2UIActions | null>(null);

/**
 * Context for reactive state (changes trigger re-renders).
 */
const A2UIStateContext = createContext<{
  version: number;
  error: string | null;
} | null>(null);

/**
 * Props for the A2UIProvider component.
 */
export interface A2UIProviderProps {
  /** Callback invoked when a user action is dispatched (button click, etc.) */
  onAction?: OnActionCallback;
  /** Theme configuration */
  theme?: Theme;
  /** Optional component catalog to use instead of the default basicCatalog */
  catalog?: any;
  /** Child components */
  children: ReactNode;
}

/**
 * Provider component that sets up the A2UI v0.9 context for descendant components.
 * Uses a two-context architecture for performance:
 * - A2UIActionsContext: Stable actions that never change (no re-renders)
 * - A2UIStateContext: Reactive state that triggers re-renders when needed
 */
export function A2UIProvider({
  onAction,
  theme,
  catalog,
  children,
}: A2UIProviderProps) {
  // Store onAction in a ref so callbacks always have the latest value
  const onActionRef = useRef<OnActionCallback | null>(onAction ?? null);
  onActionRef.current = onAction ?? null;

  // Create v0.9 MessageProcessor only once using ref
  const processorRef = useRef<MessageProcessor<any> | null>(null);
  if (!processorRef.current) {
    processorRef.current = new MessageProcessor(
      [catalog ?? basicCatalog],
      // Action handler: convert v0.9 Action to A2UIClientEventMessage format
      (action: any) => {
        if (onActionRef.current) {
          const message: A2UIClientEventMessage = {
            userAction: {
              name: action?.name ?? "unknown",
              surfaceId: action?.surfaceId ?? "default",
              sourceComponentId: action?.sourceComponentId,
              context: action?.context,
              timestamp: action?.timestamp ?? new Date().toISOString(),
            },
          };
          onActionRef.current(message);
        }
      },
    );
  }
  const processor = processorRef.current;

  // Version counter for triggering re-renders
  const [version, setVersion] = useState(0);

  // Error state for graceful error handling
  const [error, setError] = useState<string | null>(null);

  // Create stable actions object once - stored in ref, never changes
  const actionsRef = useRef<A2UIActions | null>(null);
  if (!actionsRef.current) {
    actionsRef.current = {
      processMessages: (messages: Array<Record<string, unknown>>) => {
        try {
          processor.processMessages(messages as any[]);
        } catch (err) {
          console.warn("[A2UI] processMessages error:", err);
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        setError(null);
        setVersion((v) => v + 1);
      },

      dispatch: (message: any) => {
        if (onActionRef.current) {
          onActionRef.current(message);
        }
      },

      getSurface: (surfaceId: string) => {
        return processor.model.getSurface(surfaceId);
      },

      clearSurfaces: () => {
        // Process a deleteSurface for all known surfaces
        const surfaces = processor.model.surfacesMap;
        for (const [id] of surfaces) {
          processor.processMessages([
            { version: "v0.9", deleteSurface: { surfaceId: id } } as any,
          ]);
        }
        setVersion((v) => v + 1);
      },
    };
  }
  const actions = actionsRef.current;

  // State context value - changes when version or error changes
  const stateValue = useMemo(() => ({ version, error }), [version, error]);

  return (
    <A2UIActionsContext.Provider value={actions}>
      <A2UIStateContext.Provider value={stateValue}>
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </A2UIStateContext.Provider>
    </A2UIActionsContext.Provider>
  );
}

/**
 * Hook to access stable A2UI actions (won't cause re-renders).
 */
export function useA2UIActions(): A2UIActions {
  const actions = useContext(A2UIActionsContext);
  if (!actions) {
    throw new Error("useA2UIActions must be used within an A2UIProvider");
  }
  return actions;
}

/**
 * Hook to subscribe to A2UI state changes.
 */
export function useA2UIState(): { version: number } {
  const state = useContext(A2UIStateContext);
  if (!state) {
    throw new Error("useA2UIState must be used within an A2UIProvider");
  }
  return state;
}

/**
 * Hook to access the full A2UI context (actions + state).
 */
export function useA2UIContext(): A2UIContextValue {
  const actions = useA2UIActions();
  const state = useA2UIState();

  return useMemo(
    () => ({
      ...actions,
      version: state.version,
      onAction: null,
    }),
    [actions, state.version],
  );
}

/** @deprecated Use useA2UIContext instead. */
export const useA2UIStore = useA2UIContext;

/**
 * Hook to access the current A2UI error state.
 */
export function useA2UIError(): string | null {
  const state = useContext(A2UIStateContext);
  return state?.error ?? null;
}

/** @deprecated Use useA2UIContext() or useA2UI() directly instead. */
export function useA2UIStoreSelector<T>(
  selector: (state: A2UIContextValue) => T,
): T {
  const context = useA2UIContext();
  return selector(context);
}
