import { createContext, useContext, useRef, useState, useMemo } from "react";
import type { ReactNode } from "react";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { VersionAdapterFactory } from "@a2ui/web_core/adapters";
import { basicCatalog, basicCatalogV1 } from "../a2ui-react";
import { A2UIOperationApplier } from "../../engine/apply-operations";
import { a2uiNativeOperations } from "../../engine/native-operations";
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
  surfaceErrors: Readonly<Record<string, string>>;
} | null>(null);

/** Unwrap SDK message lists once so validation and processing see the same batch. */
function normalizeMessages(
  messages: Array<Record<string, unknown>>,
  inheritedVersion: unknown = "v0.9",
): Array<Record<string, unknown>> {
  return messages.flatMap<Record<string, unknown>>((message) => {
    if (Array.isArray(message))
      return normalizeMessages(message, inheritedVersion);
    if (Array.isArray(message.messages)) {
      // The SDK selects a wrapper's adapter from its first message, then uses
      // that adapter's version for subsequent messages that omit a version.
      let first = message.messages[0];
      while (Array.isArray(first) || Array.isArray(first?.messages)) {
        first = (Array.isArray(first) ? first : first.messages)[0];
      }
      const version =
        first?.version !== undefined
          ? first.version
          : message.version !== undefined
            ? message.version
            : inheritedVersion;
      const normalized = normalizeMessages(message.messages, version);
      // Retain SDK validation for homogeneous wrappers and strict envelopes;
      // flattening must not turn a rejected wrapper into accepted messages.
      VersionAdapterFactory.resolveFromPayload({ version }).extractOperations(
        normalized,
      );
      return normalized;
    }
    return message.version === undefined
      ? { ...message, version: inheritedVersion }
      : message;
  });
}

/**
 * Surface IDs whose component tree a message replaces or removes. A rejected
 * component update stays reported until one of these succeeds; a data model
 * update leaves it in place, since it cannot fix the rejected components.
 */
function surfacesResetBy(messages: Array<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    for (const key of ["createSurface", "updateComponents", "deleteSurface"]) {
      const surfaceId = (message?.[key] as { surfaceId?: unknown } | undefined)
        ?.surfaceId;
      if (typeof surfaceId === "string") ids.push(surfaceId);
    }
  }
  return ids;
}

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
 * Provider component that sets up A2UI context for descendant components.
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

  // Processing errors per surface. web_core validates components against the
  // catalog when a message is processed and rejects the whole message, so a
  // malformed component never reaches the renderer; A2UIRenderer shows these.
  const [surfaceErrors, setSurfaceErrors] = useState<
    Readonly<Record<string, string>>
  >({});

  // The SDK processor handles both protocol versions and owns surface state.
  const processorRef = useRef<MessageProcessor<any> | null>(null);
  if (!processorRef.current) {
    // Convert surface actions to the CopilotKit client-event envelope.
    const handleAction = (action: any) => {
      if (onActionRef.current) {
        const message: A2UIClientEventMessage = {
          userAction: {
            ...action,
            name: action?.name ?? "unknown",
            surfaceId: action?.surfaceId ?? "default",
            sourceComponentId: action?.sourceComponentId,
            context: action?.context,
            timestamp: action?.timestamp ?? new Date().toISOString(),
          },
        };
        return onActionRef.current(message);
      }
    };
    processorRef.current = new MessageProcessor(
      // A selected catalog controls all rendering for its own protocol. Only
      // add the other protocol's default for historical cards; adding the
      // same-version default would bypass component enable/disable filtering.
      catalog
        ? [
            catalog,
            catalog.protocolVersion === "1.0" ? basicCatalog : basicCatalogV1,
          ]
        : [basicCatalog, basicCatalogV1],
      // No processor-level action handler: the surface group forwards actions
      // without awaiting its listeners, so `surface.dispatchAction` would
      // settle before `onAction` does. Each surface awaits its own listeners.
      undefined,
      {
        errorHandler: ({ error }) => {
          const { surfaceId, message } = error;
          if (!surfaceId) return;
          setSurfaceErrors((prev) => ({ ...prev, [surfaceId]: message }));
        },
      },
    );
    processorRef.current.onSurfaceCreated((surface) => {
      surface.onAction.subscribe(handleAction);
    });
  }
  const processor = processorRef.current;
  const applierRef = useRef<A2UIOperationApplier<any> | null>(null);
  if (!applierRef.current) {
    // v0.9 surfaces are pinned to the v0.9 catalog: the app's own unless it
    // is a native 1.0 catalog, in which case the basic v0.9 catalog renders
    // historical v0.9 cards.
    applierRef.current = new A2UIOperationApplier(
      processor,
      (catalog?.protocolVersion === "1.0"
        ? basicCatalog
        : (catalog ?? basicCatalog)
      ).id,
      undefined,
      { native: a2uiNativeOperations },
    );
  }
  const applier = applierRef.current;
  const lastSurfacesRef = useRef<readonly unknown[]>([]);

  // Version counter for triggering re-renders
  const [version, setVersion] = useState(0);

  // Error state for graceful error handling
  const [error, setError] = useState<string | null>(null);

  // Create stable actions object once - stored in ref, never changes
  const actionsRef = useRef<A2UIActions | null>(null);
  if (!actionsRef.current) {
    actionsRef.current = {
      processMessages: (messages: Array<Record<string, unknown>>) => {
        let versioned: Array<Record<string, unknown>>;
        try {
          // Registering a 1.0 catalog disables web_core's implicit v0.9
          // fallback. Preserve the existing provider default explicitly.
          versioned = normalizeMessages(messages);
          a2uiNativeOperations.validate(processor, versioned);
          processor.processMessages(versioned as any[]);
        } catch (err) {
          console.warn("[A2UI] processMessages error:", err);
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        setError(null);
        const reset = surfacesResetBy(versioned);
        if (reset.length > 0) {
          setSurfaceErrors((prev) => {
            if (!reset.some((id) => id in prev)) return prev;
            const next = { ...prev };
            for (const id of reset) delete next[id];
            return next;
          });
        }
        setVersion((v) => v + 1);
      },

      applyOperations: (operations: readonly unknown[]) => {
        const before = lastSurfacesRef.current;
        try {
          lastSurfacesRef.current = applier.apply(operations);
        } catch (err) {
          console.warn("[A2UI] processMessages error:", err);
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        setError(null);
        // The applier returns the same array when the snapshot changed nothing.
        if (lastSurfacesRef.current !== before) setVersion((v) => v + 1);
      },

      dispatch: (message: any) => onActionRef.current?.(message),

      getSurface: (surfaceId: string) => {
        return processor.model.getSurface(surfaceId);
      },

      clearSurfaces: () => {
        // Process a deleteSurface for all known surfaces
        const surfaces = processor.model.surfacesMap;
        for (const [id, surface] of surfaces) {
          processor.processMessages([
            {
              version: surface.protocolVersion ?? "v0.9",
              deleteSurface: { surfaceId: id },
            } as any,
          ]);
        }
        setSurfaceErrors({});
        setVersion((v) => v + 1);
      },
    };
  }
  const actions = actionsRef.current;

  // State context value - changes when version or error changes
  const stateValue = useMemo(
    () => ({ version, error, surfaceErrors }),
    [version, error, surfaceErrors],
  );

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

/**
 * Hook to access the current A2UI error state.
 */
export function useA2UIError(): string | null {
  const state = useContext(A2UIStateContext);
  return state?.error ?? null;
}

/**
 * Hook to access the error that rejected the last component update for a
 * surface, or null when its components were accepted.
 */
export function useA2UISurfaceError(surfaceId: string): string | null {
  const state = useContext(A2UIStateContext);
  return state?.surfaceErrors[surfaceId] ?? null;
}
