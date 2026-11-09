import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentType, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { allowedComponents } from "@copilotkit/core/generative-ui";
import {
  SurfaceView,
  useGenerativeUIRejected,
  useGenerativeUIRuntime,
  useManagerVersion,
} from "@copilotkit/react-core/v2/generative-ui/native";
import type {
  GenerativeUI,
  GenerativeUIComponentName,
} from "@copilotkit/react-core/v2/generative-ui/native";
import { GenerativeUIProviderPresentContext } from "./GenerativeUIProvider";
import type { GenerativeUIActivityWrapperProps } from "./GenerativeUIActivity";
import { useDevelopmentWarnings } from "./internal";

/**
 * The default wrapper of a named-target surface: the surface, and an alert
 * under it when operations were rejected. It draws no view of its own, so
 * the surface lays out in the view around it (`style`).
 */
function DefaultGenerativeUISurfaceWrapper({
  error,
  children,
}: GenerativeUIActivityWrapperProps) {
  return (
    <>
      {children}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Part of this UI couldn't be shown.
        </Text>
      ) : null}
    </>
  );
}

type SurfaceManager = NonNullable<
  ReturnType<typeof useGenerativeUIRuntime>
>["manager"];

/** What the start detection remembers of the surface it saw last. */
interface SeenSurface {
  key: string;
  status: string;
  serverRejected: number;
  clientRejected: number;
}

export type GenerativeUISurfaceProps<
  UI extends GenerativeUI<any> = GenerativeUI<any>,
> = {
  /** Target id the agent renders into. */
  id: string;
  /**
   * Tells the model where this surface is and what to show in it, for
   * example "The home screen, under the greeting."
   */
  description?: string;
  /**
   * Shown until a surface targets this id, and while the provider has no
   * `ui`.
   */
  fallback?: ReactNode;
  /**
   * The style of the view around the surface. It applies while the fallback
   * shows, too.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Called once each time the agent starts to render into this surface: for
   * each `render_ui` call, on a new surface or as an update, also when React
   * batches several starts into one render. Also called when the surface
   * mounts, its `id` changes, or the active thread changes, while the agent
   * is rendering into it. Not called again for the same call when the
   * component renders again, mounts under `<React.StrictMode>`, or gets a
   * new callback or a new runtime. Use it, for example, to scroll the
   * surface into view.
   *
   * A call is seen as new when the surface goes to "streaming" from another
   * status, or stays "streaming" while its rejected operations are reset
   * (the runtime resets them at the start of each call). When the app never
   * sees the end of one call, for example because a reconnect delivers the
   * next call already streaming and neither call had a rejected operation,
   * the two calls count as one start.
   *
   * It runs after React commits the render. An error it throws is caught
   * and logged with `console.error`, so the surface stays up.
   */
  onGenerationStart?: () => void;
  /**
   * Replaces the default wrapper around the surface, as on
   * `<GenerativeUIActivity>`. It gets the operations of the latest
   * `render_ui` call that were rejected, by the runtime or on the device,
   * and an `error` when there are any. The default draws the surface and,
   * under it, "Part of this UI couldn't be shown." when some were rejected.
   * The fallback is not wrapped. A surface whose `createSurface` was
   * rejected never exists, so the fallback shows; render the activity
   * message with `<GenerativeUIActivity target>` to show that error.
   */
  Wrapper?: ComponentType<GenerativeUIActivityWrapperProps>;
} & (
  | {
      /** The UI of the provider. It types the names in `components`. */
      ui: UI;
      /**
       * The only components that the agent can use in this surface. Left
       * out, every component of the UI is allowed.
       */
      components?: readonly GenerativeUIComponentName<UI>[];
    }
  | { ui?: undefined; components?: undefined }
);

/**
 * Experimental. A named place in the app where the agent can render UI. The
 * agent sees the target, with its `description`, in each run that starts
 * while it is mounted (the target list is sent at the start of the run).
 *
 * A target follows the thread that is active in the provider: the thread of
 * the last run that started on the CopilotKit core, of any agent, including
 * agents that the provider's `agentIds` leaves out. To show the output of
 * one particular agent run, use `<GenerativeUIActivity>` with that agent's
 * activity message.
 *
 * In development it warns once for each distinct problem of this instance
 * (no `ui` on the provider, a `ui` that is not the provider's, unknown
 * component names), and again for any of them after the provider's catalog
 * changes.
 *
 * It throws when there is no `<GenerativeUIProvider>` above it. Under a
 * provider with no `ui`, it shows its fallback (in development it warns).
 * The view around it, with `style` and the test ID
 * `generative-ui-surface-<id>`, is there in both states.
 *
 * @example
 * ```tsx
 * <GenerativeUISurface
 *   id="insights"
 *   ui={bankUI}
 *   description="Under the balances. Show spending insights here."
 *   components={["SpendingCard", "InsightCard"]}
 *   fallback={<InsightsPlaceholder />}
 * />
 * ```
 */
export function GenerativeUISurface<
  UI extends GenerativeUI<any> = GenerativeUI<any>,
>({
  id,
  description,
  ui,
  components,
  fallback = null,
  style,
  onGenerationStart,
  Wrapper = DefaultGenerativeUISurfaceWrapper,
}: GenerativeUISurfaceProps<UI>) {
  const runtime = useGenerativeUIRuntime();
  const hasProvider = useContext(GenerativeUIProviderPresentContext);
  if (!runtime && !hasProvider) {
    throw new Error(
      `<GenerativeUISurface id="${id}"> must be rendered inside a <GenerativeUIProvider> from @copilotkit/react-native/generative-ui.`,
    );
  }
  useManagerVersion(runtime);
  const otherUI = runtime !== null && ui !== undefined && ui !== runtime.ui;
  // A new array with the same names must not register the target again.
  const componentsKey =
    components === undefined ? undefined : JSON.stringify(components);
  const catalog = runtime?.ui;
  const allowed = useMemo(() => {
    if (!catalog || componentsKey === undefined) return undefined;
    return allowedComponents(JSON.parse(componentsKey) as string[], catalog);
  }, [catalog, componentsKey]);
  useDevelopmentWarnings(
    [
      runtime
        ? undefined
        : `[generativeUI] <GenerativeUISurface id="${id}"> shows its fallback: the <GenerativeUIProvider> above it has no \`ui\`.`,
      otherUI
        ? `[generativeUI] <GenerativeUISurface id="${id}">: the ui prop is not the UI of the provider. The components are checked against the UI of the provider.`
        : undefined,
      allowed && allowed.warning !== ""
        ? `[generativeUI] <GenerativeUISurface id="${id}">: ${allowed.warning}.`
        : undefined,
    ],
    catalog,
  );
  const allowedNames = allowed?.names;
  useLayoutEffect(() => {
    if (!runtime) return;
    return runtime.manager.registerTarget(id, {
      description,
      components: allowedNames,
    });
    // `allowedNames` changes only with the catalog or the names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, id, description, componentsKey]);
  const surface = runtime?.manager.getSurfaceForTarget(id);
  const { rejected, error } = useGenerativeUIRejected(
    surface?.serverRejected,
    surface?.clientRejected,
  );

  // Starts are detected from the manager's notifications, which come at
  // most once per ingest (only when it changes something), not from
  // renders: React can batch the "ready" of one call and the "streaming" of
  // the next into one render. What was seen last is kept in a ref, so an
  // effect that runs again (StrictMode, a new runtime) does not see the
  // same call as a new start. It is reset only when `id` changes. A new
  // runtime has a new, empty manager that the provider fills again from the
  // messages: "no surface" counts only from the manager that showed the
  // last one, so the rebuilt surface is not a new start either.
  const seen = useRef<{
    id: string;
    manager?: SurfaceManager;
    surface?: SeenSurface;
  }>({ id });
  const pendingStarts = useRef(0);
  const [, setStartTick] = useState(0);
  useEffect(() => {
    if (!runtime) return;
    const { manager } = runtime;
    if (seen.current.id !== id) seen.current = { id };
    const check = () => {
      const current = manager.getSurfaceForTarget(id);
      const last = seen.current.surface;
      if (!current) {
        if (seen.current.manager === manager) seen.current = { id, manager };
        return;
      }
      const next: SeenSurface = {
        key: current.key,
        status: current.status,
        serverRejected: current.serverRejected.length,
        clientRejected: current.clientRejected.length,
      };
      seen.current = { id, manager, surface: next };
      if (next.status !== "streaming") return;
      const isStart =
        last === undefined ||
        last.key !== next.key ||
        last.status !== "streaming" ||
        next.serverRejected < last.serverRejected ||
        next.clientRejected < last.clientRejected;
      if (isStart) {
        pendingStarts.current += 1;
        setStartTick((n) => n + 1);
      }
    };
    check();
    return manager.subscribe(check);
  }, [runtime, id]);
  const onStart = useRef(onGenerationStart);
  onStart.current = onGenerationStart;
  // After every commit: calls the callback once for each start seen since.
  useEffect(() => {
    while (pendingStarts.current > 0) {
      pendingStarts.current -= 1;
      const callback = onStart.current;
      if (!callback) continue;
      try {
        callback();
      } catch (callbackError) {
        console.error(
          `[generativeUI] <GenerativeUISurface id="${id}"> onGenerationStart threw:`,
          callbackError,
        );
      }
    }
  });
  return (
    <View style={style} testID={`generative-ui-surface-${id}`}>
      {surface ? (
        <Wrapper
          surfaceId={surface.surfaceId}
          isStreaming={surface.status === "streaming"}
          error={error}
          rejected={rejected}
        >
          <SurfaceView surface={surface} />
        </Wrapper>
      ) : (
        fallback
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { marginTop: 8, fontSize: 12, color: "#dc2626" },
});
