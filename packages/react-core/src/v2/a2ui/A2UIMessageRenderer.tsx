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
} from "./A2UIRecoveryStates";
import type { A2UIRecoveryRendererOptions } from "./A2UIRecoveryStates";

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
 * Intercept an A2UI user action before it reaches the agent.
 *
 * Called with the dispatched action and a `forward` helper that runs the agent
 * with the (optionally modified) action. The return value drives the default
 * forwarding:
 * - return `null` → the app handled it client-side (e.g. a `navigate` event);
 *   the action is NOT forwarded to the agent.
 * - return an `A2UIUserAction` → that (possibly modified) action is forwarded.
 * - return `undefined` / `void` → the original action is forwarded unchanged.
 *
 * `forward` is provided for advanced cases where you want to do async work and
 * forward manually; if you call it yourself, return `null` to suppress the
 * default forward and avoid running the agent twice.
 */
export type A2UIActionInterceptor = (
  action: A2UIUserAction,
  forward: (action?: A2UIUserAction) => Promise<void>,
) => void | A2UIUserAction | null | Promise<void | A2UIUserAction | null>;

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
  /**
   * Intercept actions before they reach the agent. Lets an app handle an action
   * client-side (e.g. `navigate`) instead of forwarding every action. See
   * {@link A2UIActionInterceptor}.
   */
  onAction?: A2UIActionInterceptor;
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
  const { theme, catalog, loadingComponent, recovery, onAction } = options;
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
      // Track from the CONTENT (not the lagging operations state) so a paint
      // snapshot never clobbers the last genuine pre-paint snapshot.
      const contentHasOps =
        Array.isArray(content?.[A2UI_OPERATIONS_KEY]) &&
        content[A2UI_OPERATIONS_KEY].length > 0;
      if (!contentHasOps) lastLoaderContentRef.current = content;

      // Cross-over: hold the loader in-flow while the surface mounts + paints
      // OFFSCREEN, then swap the instant the surface reports its first painted
      // content (onReady). That makes the card REPLACE the skeleton with no gap,
      // independent of stream latency / payload size / machine speed — a fixed
      // delay can't, since the "right" delay varies with all of those. The timer
      // below is only a safety fallback if onReady never fires. (OSS-162)
      const [surfaceReady, setSurfaceReady] = useState(false);
      const readyRef = useRef(false);
      const markSurfaceReady = useCallback(() => {
        if (readyRef.current) return;
        readyRef.current = true;
        // One frame so the painted surface is on-screen before the loader drops.
        requestAnimationFrame(() => setSurfaceReady(true));
      }, []);
      useEffect(() => {
        if (!hasOps) {
          setSurfaceReady(false);
          readyRef.current = false;
          return;
        }
        const t = setTimeout(() => setSurfaceReady(true), 8000); // fallback only
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
              onAction={onAction}
              onReady={markSurfaceReady}
            />
          ))}
        </div>
      );

      // Stable tree: ReactSurfaceHost stays MOUNTED in the same position across
      // the hold→ready swap (only its wrapper styling toggles), so the surface
      // painted OFFSCREEN during the hold is preserved — not remounted, which
      // would reintroduce the very gap we're closing. The loader sits on top
      // until ready, then is removed and the surface drops into normal flow.
      return (
        <div style={{ position: "relative" }}>
          <div
            aria-hidden={!surfaceReady}
            style={
              surfaceReady
                ? undefined
                : {
                    position: "absolute",
                    inset: 0,
                    opacity: 0,
                    pointerEvents: "none",
                  }
            }
          >
            {surfaces}
          </div>
          {!surfaceReady &&
            renderLifecycle(lastLoaderContentRef.current ?? content)}
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
  /** Optional interceptor run before an action is forwarded to the agent. */
  onAction?: A2UIActionInterceptor;
  /** Fired once the surface has processed its first operations (painted). */
  onReady?: () => void;
};

/**
 * Orchestrates a single A2UI user action: runs the optional `onAction`
 * interceptor first, then forwards to the agent unless the interceptor
 * suppressed it (returned `null`). Exported for unit testing; the wiring lives
 * in {@link ReactSurfaceHost}.
 */
export async function runA2UIAction({
  message,
  agent,
  copilotkit,
  onAction,
}: {
  message: A2UIClientEventMessage;
  agent: any;
  copilotkit: any;
  onAction?: A2UIActionInterceptor;
}): Promise<void> {
  if (!agent) return;

  const action = message.userAction as A2UIUserAction | undefined;

  // Forward to the agent, swapping in the (possibly modified) userAction while
  // preserving the rest of the original client-event envelope. Always restores
  // the prior properties afterwards so `a2uiAction` does not leak into later
  // runs. Called with no argument → the original message is forwarded as-is.
  const forward = async (forwardAction?: A2UIUserAction) => {
    const a2uiAction =
      forwardAction !== undefined
        ? { ...message, userAction: forwardAction }
        : message;
    try {
      copilotkit.setProperties({
        ...copilotkit.properties,
        a2uiAction,
      });

      await copilotkit.runAgent({ agent });
    } finally {
      if (copilotkit.properties) {
        const { a2uiAction: _omit, ...rest } = copilotkit.properties;
        copilotkit.setProperties(rest);
      }
    }
  };

  if (onAction && action) {
    const result = await onAction(action, forward);
    // null → the app handled it client-side; do NOT forward to the agent.
    if (result === null) return;
    // a returned action → forward the (possibly modified) action.
    if (result) {
      await forward(result);
      return;
    }
    // void/undefined falls through → forward unchanged (default preserved).
  }

  await forward();
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
  catalog,
  onAction,
  onReady,
}: ReactSurfaceHostProps) {
  // Bridge: when the React renderer dispatches an action, forward to CopilotKit
  const handleAction = useCallback(
    (message: A2UIClientEventMessage) =>
      runA2UIAction({ message, agent, copilotkit, onAction }),
    [agent, copilotkit, onAction],
  );

  return (
    <div className="cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4">
      <A2UIProvider onAction={handleAction} theme={theme} catalog={catalog}>
        <SurfaceMessageProcessor
          surfaceId={surfaceId}
          operations={operations}
          onReady={onReady}
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
  onReady,
}: {
  surfaceId: string;
  operations: any[];
  onReady?: () => void;
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
    // Signal the cross-over to swap ONLY once the surface can actually paint a
    // card. A data-bound list renders nothing until its data model arrives, so
    // for those we wait for the first non-empty updateDataModel; static surfaces
    // are renderable from components alone. Latency-independent. (OSS-162)
    if (onReady && surfaceHasRenderableContent(operations)) onReady();
  }, [processMessages, getSurface, surfaceId, operations, onReady]);

  return null;
}

/**
 * Whether the surface's operations are enough to paint a visible card yet.
 * A data-bound surface references its data via `path` and renders nothing until
 * the data model has ≥1 value; a static surface (no path refs) paints from its
 * components alone. Used to time the loader→surface cross-over to actual content
 * arrival rather than a fixed delay. (OSS-162)
 */
function surfaceHasRenderableContent(operations: any[]): boolean {
  const componentOps = operations.filter((o) => o?.updateComponents);
  if (!componentOps.length) return false;
  const needsData = JSON.stringify(componentOps).includes('"path"');
  if (!needsData) return true;
  return operations.some((o) => {
    const v = o?.updateDataModel?.value;
    if (!v || typeof v !== "object") return false;
    return Object.values(v).some((x) =>
      Array.isArray(x)
        ? x.length > 0
        : x !== null && x !== undefined && x !== "",
    );
  });
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
