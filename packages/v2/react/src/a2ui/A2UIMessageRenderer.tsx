import { useCopilotKit } from "../providers";
import { useA2UIActionHandlerRegistry } from "../providers/A2UIActionHandlerRegistry";
import type { ReactActivityMessageRenderer } from "../types/react-activity-message-renderer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  A2UIProvider,
  useA2UIActions,
  A2UIRenderer,
  initializeDefaultCatalog,
  injectStyles,
  DEFAULT_SURFACE_ID,
} from "@copilotkit/a2ui-renderer";
import type {
  Theme,
  A2UIClientEventMessage,
  ServerToClientMessage,
} from "@copilotkit/a2ui-renderer";

/**
 * The container key used to wrap A2UI operations for explicit detection.
 * Must match A2UI_OPERATIONS_KEY in @ag-ui/a2ui-middleware and copilotkit.a2ui (Python).
 */
const A2UI_OPERATIONS_KEY = "a2ui_operations";

// Initialize the React renderer's component catalog and styles once
let initialized = false;
function ensureInitialized() {
  if (!initialized) {
    initializeDefaultCatalog();
    injectStyles();
    initialized = true;
  }
}

/**
 * User action with dataContextPath, as dispatched by A2UI components.
 */
export type A2UIUserAction = {
  name: string;
  sourceComponentId: string;
  surfaceId: string;
  timestamp: string;
  context?: Record<string, unknown>;
  dataContextPath?: string;
};

/** A2UI operations array. */
export type A2UIOps = Array<Record<string, unknown>>;

/**
 * Pre-declared action operations resolved for this specific action.
 * Contains the exact-match or catch-all ops from the agent's action_handlers,
 * or null if no match.
 */
export type A2UIDeclaredOps = A2UIOps | null;

/**
 * A single action handler function.
 *
 * @param action - The dispatched user action.
 * @param declaredOps - Pre-declared A2UI operations for this action from the
 *   agent's action_handlers (exact name match or "*" catch-all), or null.
 *   The handler can use these directly, modify them, or ignore them.
 */
export type A2UIActionHandler = (
  action: A2UIUserAction,
  declaredOps: A2UIDeclaredOps,
) => A2UIOps | null | undefined | void;

/**
 * Orchestrator that receives the action, all registered handlers, and the
 * pre-declared action handlers map.
 *
 * Default behavior (when not provided): loops through handlers and uses
 * the first one that returns a non-empty operations array. If no handler
 * matches, falls back to the pre-declared ops directly.
 *
 * @param action - The dispatched user action.
 * @param handlers - All registered handlers (from useA2UIActionHandler hooks).
 * @param declaredHandlers - The full action_handlers map from the agent, or undefined.
 */
export type A2UIActionOrchestrator = (
  action: A2UIUserAction,
  handlers: A2UIActionHandler[],
  declaredHandlers: Record<string, A2UIOps> | undefined,
) => A2UIOps | null | undefined | void;

export type A2UIMessageRendererOptions = {
  theme: Theme;
  /** Optional orchestrator for A2UI action dispatch. */
  onAction?: A2UIActionOrchestrator;
};

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): ReactActivityMessageRenderer<any> {
  const { theme, onAction } = options;

  return {
    activityType: "a2ui-surface",
    content: z.any(),
    render: ({ content, agent }) => {
      ensureInitialized();

      const [operations, setOperations] = useState<any[]>([]);
      const [actionHandlers, setActionHandlers] = useState<
        Record<string, any[]> | undefined
      >(undefined);
      const { copilotkit } = useCopilotKit();

      const lastContentRef = useRef<unknown>(null);
      useEffect(() => {
        // Skip if same content reference
        if (content === lastContentRef.current) return;
        lastContentRef.current = content;

        const incoming = content?.[A2UI_OPERATIONS_KEY];
        if (!content || !Array.isArray(incoming)) {
          setOperations([]);
          setActionHandlers(undefined);
          return;
        }

        setOperations(incoming);

        // Extract pre-declared action handlers from the content
        const handlers = content?.actionHandlers;
        if (
          handlers &&
          typeof handlers === "object" &&
          !Array.isArray(handlers)
        ) {
          setActionHandlers(handlers);
        }
      }, [content]);

      // Group operations by surface ID
      const groupedOperations = useMemo(() => {
        const groups = new Map<string, any[]>();

        for (const operation of operations) {
          const surfaceId =
            getOperationSurfaceId(operation) ?? DEFAULT_SURFACE_ID;

          if (!groups.has(surfaceId)) {
            groups.set(surfaceId, []);
          }
          groups.get(surfaceId)!.push(operation);
        }

        return groups;
      }, [operations]);

      if (!groupedOperations.size) {
        return null;
      }

      return (
        <div className="cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-6 cpk:overflow-auto cpk:py-6">
          {Array.from(groupedOperations.entries()).map(([surfaceId, ops]) => (
            <ReactSurfaceHost
              key={surfaceId}
              surfaceId={surfaceId}
              operations={ops}
              theme={theme}
              agent={agent}
              copilotkit={copilotkit}
              onAction={onAction}
              actionHandlers={actionHandlers}
            />
          ))}
        </div>
      );
    },
  };
}

type ReactSurfaceHostProps = {
  surfaceId: string;
  operations: any[];
  theme: Theme;
  agent: any;
  copilotkit: any;
  onAction?: A2UIActionOrchestrator;
  /** Pre-declared action handlers from the agent's a2ui_action_handlers */
  actionHandlers?: Record<string, any[]>;
};

/**
 * Resolve the pre-declared ops for a given action: exact name match first,
 * then "*" catch-all, or null.
 */
export function resolveDeclaredOps(
  action: A2UIUserAction,
  declaredHandlers: Record<string, A2UIOps> | undefined,
): A2UIDeclaredOps {
  if (!declaredHandlers) return null;
  return declaredHandlers[action.name] ?? declaredHandlers["*"] ?? null;
}

/**
 * Default orchestrator implementation.
 *
 * 1. Loops through hook-registered handlers, passing declaredOps to each.
 *    First handler that returns a non-empty array wins.
 * 2. If no handler matches, falls back to declaredOps directly.
 *
 * This means pre-declared ops are the default, but any hook can override
 * or transform them.
 */
export function defaultActionOrchestrator(
  action: A2UIUserAction,
  handlers: A2UIActionHandler[],
  declaredHandlers: Record<string, A2UIOps> | undefined,
): A2UIOps | null {
  const declaredOps = resolveDeclaredOps(action, declaredHandlers);

  // Check hook handlers first — they can use, modify, or ignore declaredOps
  for (const handler of handlers) {
    const ops = handler(action, declaredOps);
    if (ops && ops.length > 0) return ops;
  }

  // Fall back to pre-declared ops
  return declaredOps;
}

/**
 * Renders a single A2UI surface using the React renderer.
 * Wraps A2UIProvider + A2UIRenderer and bridges actions back to CopilotKit.
 */
function ReactSurfaceHost({
  surfaceId,
  operations,
  theme,
  agent,
  copilotkit,
  onAction: onActionOrchestrator,
  actionHandlers: declaredHandlers,
}: ReactSurfaceHostProps) {
  // Ref to access A2UI actions from inside the provider context
  const actionsRef = useRef<ReturnType<typeof useA2UIActions> | null>(null);
  const registry = useA2UIActionHandlerRegistry();

  // Bridge: when the React renderer dispatches an action, apply
  // optimistic updates then forward to CopilotKit
  const handleAction = useCallback(
    async (message: A2UIClientEventMessage) => {
      if (!agent) return;

      const action = message.userAction as A2UIUserAction | undefined;
      console.info("[A2UI] Action dispatched", action);

      // Run optimistic updates via orchestrator
      if (actionsRef.current && action) {
        const hookHandlers = registry.getHandlers();
        const orchestrate = onActionOrchestrator ?? defaultActionOrchestrator;
        const optimisticOps = orchestrate(
          action,
          hookHandlers,
          declaredHandlers,
        );
        if (optimisticOps && optimisticOps.length > 0) {
          actionsRef.current.processMessages(optimisticOps as any[]);
        }
      }

      try {
        copilotkit.setProperties({
          ...(copilotkit.properties ?? {}),
          a2uiAction: message,
        });

        await copilotkit.runAgent({ agent });
      } finally {
        if (copilotkit.properties) {
          const { a2uiAction, ...rest } = copilotkit.properties;
          copilotkit.setProperties(rest);
        }
      }
    },
    [agent, copilotkit, onActionOrchestrator, registry],
  );

  return (
    <div className="cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4">
      <A2UIProvider onAction={handleAction} theme={theme}>
        <ActionsBridge actionsRef={actionsRef} />
        <SurfaceMessageProcessor
          surfaceId={surfaceId}
          operations={operations}
        />
        <A2UIRenderer surfaceId={surfaceId} className="cpk:flex cpk:flex-1" />
      </A2UIProvider>
    </div>
  );
}

/**
 * Bridges A2UI actions context into a ref accessible by the parent component.
 * This allows handleAction (which is outside the provider) to read/write data.
 */
function ActionsBridge({
  actionsRef,
}: {
  actionsRef: React.MutableRefObject<ReturnType<typeof useA2UIActions> | null>;
}) {
  const actions = useA2UIActions();
  actionsRef.current = actions;
  return null;
}

/**
 * Processes A2UI operations into the provider's message processor.
 * Must be a child of A2UIProvider to access the actions context.
 */
function SurfaceMessageProcessor({
  surfaceId,
  operations,
}: {
  surfaceId: string;
  operations: any[];
}) {
  const { processMessages } = useA2UIActions();
  const lastOpsRef = useRef<any[]>([]);
  useEffect(() => {
    // Skip if same reference (no change)
    if (operations === lastOpsRef.current) return;
    lastOpsRef.current = operations;

    processMessages(operations);
  }, [processMessages, operations]);

  return null;
}

function getOperationSurfaceId(operation: any): string | null {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  if (typeof operation.surfaceId === "string") {
    return operation.surfaceId;
  }

  return (
    operation?.beginRendering?.surfaceId ??
    operation?.surfaceUpdate?.surfaceId ??
    operation?.dataModelUpdate?.surfaceId ??
    operation?.deleteSurface?.surfaceId ??
    null
  );
}
