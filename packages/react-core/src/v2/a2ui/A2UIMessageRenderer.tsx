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
import {
  A2UILifecycleFields,
  A2UIBuildingState,
  A2UIRetryingState,
  A2UIRecoveryFailure,
  resolveDebugExposure,
  type A2UIRecoveryRendererOptions,
} from "./A2UIRecoveryStates";

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
  /** Optional custom loading component shown while the A2UI surface is building. */
  loadingComponent?: React.ComponentType;
  /**
   * Pre-paint recovery/loading UX options (OSS-162): timing before the
   * "Retrying…" sub-label appears + how much retry/debug detail to surface.
   */
  recovery?: A2UIRecoveryRendererOptions;
};

/**
 * The `a2ui-surface` activity carries the WHOLE generative-UI lifecycle on one
 * stable messageId (OSS-162): pre-paint `status` ("building" | "retrying" |
 * "failed") with recovery detail, then `a2ui_operations` on paint. The states
 * swap in place, so the painted surface replaces the skeleton with no extra
 * coordination. `.passthrough()` preserves operations + any future fields.
 */
const A2UISurfaceContentSchema = z
  .object({
    a2ui_operations: z.array(z.any()).optional(),
    ...A2UILifecycleFields,
  })
  .passthrough();

export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): ReactActivityMessageRenderer<any> {
  const { theme, catalog, loadingComponent, recovery } = options;
  const showAfterMs = recovery?.showAfterMs ?? 2000;
  const showAfterAttempts = recovery?.showAfterAttempts ?? 2;
  const optionDebugExposure = recovery?.debugExposure ?? "collapsed";

  return {
    activityType: "a2ui-surface",
    content: A2UISurfaceContentSchema,
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

      const hasOps = groupedOperations.size > 0;

      // Renders the pre-paint lifecycle state for a given content snapshot.
      const renderLifecycle = (c: any) => {
        const status = c?.status;
        const debugExposure = resolveDebugExposure(c, optionDebugExposure);
        if (status === "failed") {
          return (
            <A2UIRecoveryFailure content={c} debugExposure={debugExposure} />
          );
        }
        if (status === "retrying") {
          return (
            <A2UIRetryingState
              content={c}
              showAfterMs={showAfterMs}
              showAfterAttempts={showAfterAttempts}
              debugExposure={debugExposure}
            />
          );
        }
        // "building" / default: a host-supplied loader wins; else the skeleton.
        if (loadingComponent) {
          const LoadingComponent = loadingComponent;
          return <LoadingComponent />;
        }
        return <A2UIBuildingState content={c} />;
      };

      // Remember the last pre-paint snapshot so the hand-off below keeps showing
      // exactly what was on screen (building skeleton w/ its count, or the retry
      // status) instead of flickering to a generic one.
      const lastLoaderContentRef = useRef<any>(null);
      if (!hasOps) lastLoaderContentRef.current = content;

      // Cross-over: when operations first arrive, the A2UIProvider needs a couple
      // ticks to process them and paint. Hold the loader in-flow (it defines the
      // height) while the surface paints OFFSCREEN, then swap — so the first card
      // REPLACES the skeleton with no empty gap. (OSS-162)
      const [surfaceReady, setSurfaceReady] = useState(false);
      useEffect(() => {
        if (!hasOps) {
          setSurfaceReady(false);
          return;
        }
        const t = setTimeout(() => setSurfaceReady(true), 220);
        return () => clearTimeout(t);
      }, [hasOps]);

      if (!hasOps) {
        // No painted surface yet → render the pre-paint lifecycle state. These
        // share this activity's messageId, so the painted surface below replaces
        // them in place once operations arrive.
        return renderLifecycle(content);
      }

      const surfaces = (
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

      if (surfaceReady) return surfaces;

      // Surface mounts/paints offscreen behind the still-visible loader.
      return (
        <div style={{ position: "relative" }}>
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              pointerEvents: "none",
            }}
          >
            {surfaces}
          </div>
          {renderLifecycle(lastLoaderContentRef.current ?? content)}
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
