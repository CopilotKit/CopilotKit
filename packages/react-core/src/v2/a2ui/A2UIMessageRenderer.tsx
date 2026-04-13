import { useCopilotKit } from "../providers";
import type { ReactActivityMessageRenderer } from "../types/react-activity-message-renderer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
  A2UIRenderer,
  initializeDefaultCatalog,
  injectStyles,
  DEFAULT_SURFACE_ID,
} from "@copilotkit/a2ui-renderer";
import type { Theme, A2UIClientEventMessage } from "@copilotkit/a2ui-renderer";

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

export type A2UIMessageRendererOptions = {
  theme: Theme;
  /** Optional component catalog to pass to A2UIProvider */
  catalog?: any;
  /** Optional custom loading component shown while A2UI surface is generating. */
  loadingComponent?: React.ComponentType;
};

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): ReactActivityMessageRenderer<any> {
  const { theme, catalog, loadingComponent } = options;

  return {
    activityType: "a2ui-surface",
    content: z.any(),
    render: ({ content, agent }) => {
      ensureInitialized();

      const [operations, setOperations] = useState<any[]>([]);
      const { copilotkit } = useCopilotKit();

      const lastContentRef = useRef<unknown>(null);
      useEffect(() => {
        // Skip if same content reference
        if (content === lastContentRef.current) return;
        lastContentRef.current = content;

        const incoming = content?.[A2UI_OPERATIONS_KEY];
        if (!content || !Array.isArray(incoming)) {
          setOperations([]);
          return;
        }

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
        // Show loading state while A2UI surface is being generated
        const LoadingComponent = loadingComponent ?? DefaultA2UILoading;
        return <LoadingComponent />;
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
              catalog={catalog}
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
  /** Optional component catalog to pass to A2UIProvider */
  catalog?: any;
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
  catalog,
}: ReactSurfaceHostProps) {
  // Bridge: when the React renderer dispatches an action, forward to CopilotKit
  const handleAction = useCallback(
    async (message: A2UIClientEventMessage) => {
      if (!agent) return;

      const action = message.userAction as A2UIUserAction | undefined;

      try {
        copilotkit.setProperties({
          ...copilotkit.properties,
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
    [agent, copilotkit],
  );

  return (
    <div className="cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4">
      <A2UIProvider onAction={handleAction} theme={theme} catalog={catalog}>
        <SurfaceMessageProcessor
          surfaceId={surfaceId}
          operations={operations}
        />
        <A2UISurfaceOrError surfaceId={surfaceId} />
      </A2UIProvider>
    </div>
  );
}

/**
 * Renders the A2UI surface, or an error message if processing failed.
 * Must be a child of A2UIProvider to access the error state.
 */
function A2UISurfaceOrError({ surfaceId }: { surfaceId: string }) {
  const error = useA2UIError();
  if (error) {
    return (
      <div className="cpk:rounded-lg cpk:border cpk:border-red-200 cpk:bg-red-50 cpk:p-3 cpk:text-sm cpk:text-red-700">
        A2UI render error: {error}
      </div>
    );
  }
  return <A2UIRenderer surfaceId={surfaceId} className="cpk:flex cpk:flex-1" />;
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
  const { processMessages, getSurface } = useA2UIActions();
  const lastHashRef = useRef<string>("");
  useEffect(() => {
    // Skip if operations haven't actually changed (deep compare via hash).
    // ACTIVITY_DELTA + ACTIVITY_SNAPSHOT can trigger multiple renders with
    // the same logical content but different object references.
    const hash = JSON.stringify(operations);
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    // Filter out createSurface if the surface already exists — the
    // MessageProcessor throws on duplicate createSurface, but content
    // snapshots always include the full operation list.
    const existing = getSurface(surfaceId);
    const ops = existing
      ? operations.filter((op) => !op?.createSurface)
      : operations;

    // Error handling is done inside A2UIProvider.processMessages
    processMessages(ops);
  }, [processMessages, getSurface, surfaceId, operations]);

  return null;
}

/**
 * Default loading component shown while an A2UI surface is generating.
 * Displays an animated shimmer skeleton.
 */
function DefaultA2UILoading() {
  return (
    <div
      className="cpk:flex cpk:flex-col cpk:gap-3 cpk:rounded-xl cpk:border cpk:border-gray-100 cpk:bg-gray-50/50 cpk:p-5"
      style={{ minHeight: 120 }}
    >
      <div className="cpk:flex cpk:items-center cpk:gap-2">
        <div
          className="cpk:h-3 cpk:w-3 cpk:rounded-full cpk:bg-gray-200"
          style={{
            animation: "cpk-a2ui-pulse 1.5s ease-in-out infinite",
          }}
        />
        <span className="cpk:text-xs cpk:font-medium cpk:text-gray-400">
          Generating UI...
        </span>
      </div>
      <div className="cpk:flex cpk:flex-col cpk:gap-2">
        {[0.8, 0.6, 0.4].map((width, i) => (
          <div
            key={i}
            className="cpk:h-3 cpk:rounded cpk:bg-gray-200/70"
            style={{
              width: `${width * 100}%`,
              animation: `cpk-a2ui-pulse 1.5s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes cpk-a2ui-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function getOperationSurfaceId(operation: any): string | null {
  if (!operation || typeof operation !== "object") {
    return null;
  }

  if (typeof operation.surfaceId === "string") {
    return operation.surfaceId;
  }

  // v0.9 message keys
  return (
    operation?.createSurface?.surfaceId ??
    operation?.updateComponents?.surfaceId ??
    operation?.updateDataModel?.surfaceId ??
    operation?.deleteSurface?.surfaceId ??
    null
  );
}
