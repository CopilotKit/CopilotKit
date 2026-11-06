import { useCopilotKit } from "../providers";
import type { ReactActivityMessageRenderer } from "../types/react-activity-message-renderer";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
  A2UIRenderer,
  initializeDefaultCatalog,
  injectStyles,
} from "@copilotkit/a2ui-renderer";
import type { Theme, A2UIClientEventMessage } from "@copilotkit/a2ui-renderer";
import { A2UISurfaceDiagnostics } from "@copilotkit/a2ui-renderer/engine-core";
import {
  ɵA2UIActivityController,
  ɵA2UI_SURFACE_ACTIVITY_TYPE,
  ɵA2UI_SURFACE_CONTENT_SCHEMA,
  ɵgroupA2UIOperationsBySurface,
  ɵrunA2UIAction,
  ɵtoA2UIClientEvent,
} from "@copilotkit/core";
import type {
  ɵA2UIActionAgent,
  ɵA2UIActionCore,
  ɵA2UIActionInterceptor,
  ɵA2UIOperation,
  ɵA2UIUserAction,
} from "@copilotkit/core";
import { A2UILifecycleState } from "./A2UIRecoveryStates";
import type { A2UIRecoveryRendererOptions } from "./A2UIRecoveryStates";

// Initialize the React renderer's component catalog and styles once
let initialized = false;
function ensureInitialized() {
  if (!initialized) {
    initializeDefaultCatalog();
    injectStyles();
    initialized = true;
  }
}

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";
const warnInDevelopment = IS_DEVELOPMENT
  ? (message: string) => console.warn(message)
  : undefined;

/** User action with dataContextPath, as dispatched by A2UI components. */
export type A2UIUserAction = ɵA2UIUserAction;

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
export type A2UIActionInterceptor = ɵA2UIActionInterceptor;

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
 * "failed") with recovery detail, then `a2ui_operations` on paint. Core's
 * `ɵA2UIActivityController` decides what shows; this renderer draws it and
 * keeps the surface mounted across the loader → surface hand-off.
 */
export function createA2UIMessageRenderer(
  options: A2UIMessageRendererOptions,
): ReactActivityMessageRenderer<any> {
  const { theme, catalog, loadingComponent, recovery, onAction } = options;

  return {
    activityType: ɵA2UI_SURFACE_ACTIVITY_TYPE,
    content: ɵA2UI_SURFACE_CONTENT_SCHEMA,
    render: ({ content, agent }) => {
      ensureInitialized();
      const { copilotkit } = useCopilotKit();

      const [controller] = useState(() => {
        const created = new ɵA2UIActivityController({
          recovery,
          warn: warnInDevelopment,
        });
        created.setContent(content);
        return created;
      });
      const snapshot = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
      );
      useEffect(() => {
        controller.setContent(content);
      }, [controller, content]);
      useEffect(() => () => controller.dispose(), [controller]);

      const markRendered = useCallback(
        () => controller.markRendered(),
        [controller],
      );
      const groups = useMemo(
        () => ɵgroupA2UIOperationsBySurface(snapshot.operations),
        [snapshot.operations],
      );

      if (snapshot.view === "lifecycle") {
        return (
          <A2UILifecycleState
            snapshot={snapshot}
            loadingComponent={loadingComponent}
          />
        );
      }

      const surfaces = (
        <div className="cpk-a2ui-message-surfaces">
          {Array.from(groups.entries()).map(([surfaceId, operations]) => (
            <ReactSurfaceHost
              key={surfaceId}
              surfaceId={surfaceId}
              operations={operations}
              theme={theme}
              agent={agent}
              copilotkit={copilotkit}
              catalog={catalog}
              onAction={onAction}
              onRendered={markRendered}
            />
          ))}
        </div>
      );

      // Stable tree: ReactSurfaceHost stays MOUNTED in the same position across
      // the hand-off (only its wrapper styling toggles), so the surface painted
      // offscreen during the hand-off is kept, not remounted. The loader sits on
      // top until the controller reports the surface painted.
      const handingOff = snapshot.view === "handoff";
      return (
        <div style={{ position: "relative" }}>
          <div
            aria-hidden={handingOff}
            style={
              handingOff
                ? {
                    position: "absolute",
                    inset: 0,
                    opacity: 0,
                    pointerEvents: "none",
                  }
                : undefined
            }
          >
            {surfaces}
          </div>
          {handingOff && (
            <A2UILifecycleState
              snapshot={snapshot}
              loadingComponent={loadingComponent}
            />
          )}
        </div>
      );
    },
  };
}

type ReactSurfaceHostProps = {
  surfaceId: string;
  operations: readonly ɵA2UIOperation[];
  theme: Theme;
  agent: ɵA2UIActionAgent | undefined;
  copilotkit: ɵA2UIActionCore;
  /** Optional component catalog to pass to A2UIProvider */
  catalog?: any;
  /** Optional interceptor run before an action is forwarded to the agent. */
  onAction?: A2UIActionInterceptor;
  /** Fired every time the surface applied operations. */
  onRendered: () => void;
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
  onAction,
  onRendered,
}: ReactSurfaceHostProps) {
  // Core runs the interceptor and the agent with the client-event envelope.
  const handleAction = useCallback(
    ({ userAction }: A2UIClientEventMessage) =>
      ɵrunA2UIAction({
        message: ɵtoA2UIClientEvent(userAction ?? {}),
        agent,
        core: copilotkit,
        onAction,
      }),
    [agent, copilotkit, onAction],
  );

  return (
    <div className="cpk-a2ui-message-surface-host">
      <A2UIProvider onAction={handleAction} theme={theme} catalog={catalog}>
        <SurfaceMessageProcessor
          operations={operations}
          onRendered={onRendered}
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
      <div className="cpk-a2ui-message-error">A2UI render error: {error}</div>
    );
  }
  return (
    <A2UIRenderer surfaceId={surfaceId} className="cpk-a2ui-message-surface" />
  );
}

/**
 * Applies the surface's operations to the provider's processor, reports each
 * applied batch to the activity controller, and runs the development
 * diagnostics. Must be a child of A2UIProvider.
 */
function SurfaceMessageProcessor({
  operations,
  onRendered,
}: {
  operations: readonly ɵA2UIOperation[];
  onRendered: () => void;
}) {
  const { applyOperations, getSurface } = useA2UIActions();
  const [diagnostics] = useState(() =>
    warnInDevelopment
      ? new A2UISurfaceDiagnostics({ warn: warnInDevelopment })
      : null,
  );
  useEffect(() => () => diagnostics?.dispose(), [diagnostics]);

  useEffect(() => {
    applyOperations(operations);
    onRendered();
    diagnostics?.check(operations, { getSurface });
  }, [applyOperations, getSurface, operations, onRendered, diagnostics]);

  return null;
}
