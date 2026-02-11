import {
  createContext,
  useContext,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import { Data, type Types } from '@a2ui/lit/0.8';
import type { A2UIContextValue, A2UIActions } from './store';
import { ThemeProvider } from '../theme/ThemeContext';
import type { OnActionCallback } from '../types';

/**
 * Context for stable actions (never changes reference, prevents re-renders).
 * Components that only need to dispatch actions or read data won't re-render.
 */
const A2UIActionsContext = createContext<A2UIActions | null>(null);

/**
 * Context for reactive state (changes trigger re-renders).
 * Only components that need to react to state changes subscribe to this.
 */
const A2UIStateContext = createContext<{ version: number } | null>(null);

/**
 * Props for the A2UIProvider component.
 */
export interface A2UIProviderProps {
  /** Callback invoked when a user action is dispatched (button click, etc.) */
  onAction?: OnActionCallback;
  /** Theme configuration. Falls back to default theme if not provided. */
  theme?: Types.Theme;
  /** Child components */
  children: ReactNode;
}

/**
 * Provider component that sets up the A2UI context for descendant components.
 *
 * This provider uses a two-context architecture for performance:
 * - A2UIActionsContext: Stable actions that never change (no re-renders)
 * - A2UIStateContext: Reactive state that triggers re-renders when needed
 *
 * @example
 * ```tsx
 * function App() {
 *   const handleAction = async (message) => {
 *     const response = await fetch('/api/a2ui', {
 *       method: 'POST',
 *       body: JSON.stringify(message)
 *     });
 *     const newMessages = await response.json();
 *   };
 *
 *   return (
 *     <A2UIProvider onAction={handleAction}>
 *       <A2UIRenderer surfaceId="main" />
 *     </A2UIProvider>
 *   );
 * }
 * ```
 */
export function A2UIProvider({ onAction, theme, children }: A2UIProviderProps) {
  // Create message processor only once using ref
  const processorRef = useRef<Types.MessageProcessor | null>(null);
  if (!processorRef.current) {
    processorRef.current = Data.createSignalA2uiMessageProcessor();
  }
  const processor = processorRef.current;

  // Version counter for triggering re-renders
  const [version, setVersion] = useState(0);

  // Store onAction in a ref so callbacks always have the latest value
  const onActionRef = useRef<OnActionCallback | null>(onAction ?? null);
  onActionRef.current = onAction ?? null;

  // Create stable actions object once - stored in ref, never changes
  const actionsRef = useRef<A2UIActions | null>(null);
  if (!actionsRef.current) {
    actionsRef.current = {
      processMessages: (messages: Types.ServerToClientMessage[]) => {
        processor.processMessages(messages);
        setVersion((v) => v + 1);
      },

      setData: (
        node: Types.AnyComponentNode | null,
        path: string,
        value: Types.DataValue,
        surfaceId: string
      ) => {
        processor.setData(node, path, value, surfaceId);
        setVersion((v) => v + 1);
      },

      dispatch: (message: Types.A2UIClientEventMessage) => {
        if (onActionRef.current) {
          onActionRef.current(message);
        }
      },

      clearSurfaces: () => {
        processor.clearSurfaces();
        setVersion((v) => v + 1);
      },

      getSurface: (surfaceId: string) => {
        return processor.getSurfaces().get(surfaceId);
      },

      getSurfaces: () => {
        return processor.getSurfaces();
      },

      getData: (node: Types.AnyComponentNode, path: string, surfaceId: string) => {
        return processor.getData(node, path, surfaceId);
      },

      resolvePath: (path: string, dataContextPath?: string) => {
        return processor.resolvePath(path, dataContextPath);
      },
    };
  }
  const actions = actionsRef.current;

  // State context value - only changes when version changes
  const stateValue = useMemo(() => ({ version }), [version]);

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
 * Use this when you only need to dispatch actions or read data.
 *
 * @returns Stable actions object
 * @throws If used outside of an A2UIProvider
 */
export function useA2UIActions(): A2UIActions {
  const actions = useContext(A2UIActionsContext);
  if (!actions) {
    throw new Error('useA2UIActions must be used within an A2UIProvider');
  }
  return actions;
}

/**
 * Hook to subscribe to A2UI state changes.
 * Components using this will re-render when state changes.
 *
 * @returns Current version number
 * @throws If used outside of an A2UIProvider
 */
export function useA2UIState(): { version: number } {
  const state = useContext(A2UIStateContext);
  if (!state) {
    throw new Error('useA2UIState must be used within an A2UIProvider');
  }
  return state;
}

/**
 * Hook to access the full A2UI context (actions + state).
 * Components using this will re-render when state changes.
 *
 * @returns The A2UI context value
 * @throws If used outside of an A2UIProvider
 */
export function useA2UIContext(): A2UIContextValue {
  const actions = useA2UIActions();
  const state = useA2UIState();

  // Memoize combined value - only changes when state changes
  // Actions are stable, so this only re-creates when version changes
  return useMemo(
    () => ({
      ...actions,
      processor: null as unknown as Types.MessageProcessor, // Not exposed directly
      version: state.version,
      onAction: null, // Use dispatch instead
    }),
    [actions, state.version]
  );
}

/**
 * @deprecated Use useA2UIContext instead. This alias exists for backward compatibility only.
 */
export const useA2UIStore = useA2UIContext;

/**
 * @deprecated This selector pattern does not provide performance benefits with React Context.
 * Components will re-render on any context change regardless of what you select.
 * Use useA2UIContext() or useA2UI() directly instead.
 *
 * @param selector - Function to select a slice of state
 * @returns The selected state
 */
export function useA2UIStoreSelector<T>(selector: (state: A2UIContextValue) => T): T {
  const context = useA2UIContext();
  return selector(context);
}
