import { useCopilotKit } from "../providers";
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

/**
 * Handler called when an A2UI action is dispatched (e.g., button click).
 * Return an array of A2UI operations to apply optimistically on the frontend
 * before the action reaches the agent, or null/undefined to skip.
 */
export type A2UIActionHandler = (
  action: A2UIUserAction,
) => Array<Record<string, unknown>> | null | undefined | void;

export type A2UIMessageRendererOptions = {
  theme: Theme;
  /** Optional handler for optimistic UI updates on A2UI actions. */
  onAction?: A2UIActionHandler;
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
      const lastSignatureRef = useRef<string | null>(null);
      const { copilotkit } = useCopilotKit();

      useEffect(() => {
        // Support both explicit container and legacy (operations)
        const incoming = content?.[A2UI_OPERATIONS_KEY] ?? content?.operations;
        if (!content || !Array.isArray(incoming)) {
          lastSignatureRef.current = null;
          setOperations([]);
          return;
        }
        const signature = stringifyOperations(incoming);

        if (signature && signature === lastSignatureRef.current) {
          return;
        }

        lastSignatureRef.current = signature;
        setOperations(incoming);
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
  onAction?: A2UIActionHandler;
};

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
  onAction: onActionHandler,
}: ReactSurfaceHostProps) {
  // Ref to access A2UI actions from inside the provider context
  const actionsRef = useRef<ReturnType<typeof useA2UIActions> | null>(null);

  // Bridge: when the React renderer dispatches an action, apply
  // optimistic updates then forward to CopilotKit
  const handleAction = useCallback(
    async (message: A2UIClientEventMessage) => {
      if (!agent) return;

      const action = message.userAction as A2UIUserAction | undefined;
      console.info("[A2UI] Action dispatched", action);

      // Optimistic update: call the onAction handler to get operations
      // to apply immediately before the agent responds.
      if (actionsRef.current && action && onActionHandler) {
        const optimisticOps = onActionHandler(action);
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
    [agent, copilotkit, onActionHandler],
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
  const lastProcessedRef = useRef<string>("");

  useEffect(() => {
    const key = `${surfaceId}-${JSON.stringify(operations)}`;
    if (key === lastProcessedRef.current) return;
    lastProcessedRef.current = key;

    processMessages(operations);
  }, [processMessages, surfaceId, operations]);

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

function stringifyOperations(ops: any[]): string | null {
  try {
    return JSON.stringify(ops);
  } catch (error) {
    return null;
  }
}
