import React, { Component, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { toError, withCause } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIErrorInfo } from "@copilotkit/shared/generative-ui";
import { reportErrorSafely } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import { useGenerativeUIHost } from "./host";

export { toError, withCause };

/**
 * A child that has not streamed yet renders nothing. The prose keeps
 * streaming above the surface, and each component appears as soon as it is
 * complete. A grey block in its place would read as a broken layout.
 */
export function NodePlaceholder(_props: { componentId: string }) {
  return null;
}

/**
 * The error that a fallback threw, told apart from the error of the
 * component it stood in for. The fallback's own error is the `cause`.
 */
function fallbackError(error: Error, componentId: string | undefined) {
  const subject = componentId === undefined ? "the surface" : componentId;
  return withCause(
    new Error(`The error fallback of ${subject} threw: ${error.message}`),
    error,
  );
}

/**
 * What the boundaries of one surface have reported, so that each failure
 * is reported once per place until its content changes. A slot is one place
 * that can fail (a node's boundary, a fallback, the surface root); it keeps
 * the last failure it reported until it renders again without one. A
 * failure that comes back the same while the slot keeps failing (a new
 * revision that throws the same error, a fallback that throws again for the
 * same message) is not reported again; a different one is.
 *
 * A place that unmounts lets go of its slots, but not at once: React also
 * unmounts and mounts again what has not changed (StrictMode runs every
 * effect twice, <Activity> hides and shows a subtree, an ancestor remounts
 * its children). A slot that is let go of keeps its memory until new content
 * arrives (`settle`), and keeps it for good when its place mounts again
 * before that. So a node that goes away and comes back with new content
 * reports its failure again, and a node that only remounts does not.
 */
export interface GenerativeUIFailureLog {
  report(
    runtime: GenerativeUIRuntime,
    slot: string,
    info: GenerativeUIErrorInfo,
    /** What the failure happened for, such as the message a fallback showed. */
    context?: string,
  ): void;
  /** The slot rendered without a failure. */
  clear(slot: string): void;
  /** The place of the slot mounted (again). */
  retain(slot: string): void;
  /** The place of the slot unmounted: forget it at the next `settle`. */
  release(slot: string): void;
  /**
   * New content of the surface arrived: forget the slots let go of since.
   * `missed` is for content that arrived while no one was watching (an
   * <Activity> hid the whole surface): it also forgets the slots whose
   * places mounted again since they were let go of, because they mount
   * again, and report their failures again, before the surface can tell
   * that its content changed. Those reports were held back as repeats;
   * they are made now.
   */
  settle(missed?: boolean): void;
}

export function createFailureLog(): GenerativeUIFailureLog {
  const last = new Map<string, string>();
  const released = new Set<string>();
  // Every slot let go of since the last settle, also the ones retained since.
  const releasedSinceSettle = new Set<string>();
  // Repeats held back for slots in `releasedSinceSettle`, which a missed
  // settle makes after all.
  const heldBack = new Map<
    string,
    {
      runtime: GenerativeUIRuntime;
      info: GenerativeUIErrorInfo;
      signature: string;
    }
  >();
  return {
    report(runtime, slot, info, context = "") {
      released.delete(slot);
      const signature = [
        info.kind,
        info.error.name,
        info.error.message,
        context,
      ].join("\n");
      if (last.get(slot) === signature) {
        if (releasedSinceSettle.has(slot)) {
          heldBack.set(slot, { runtime, info, signature });
        }
        return;
      }
      heldBack.delete(slot);
      last.set(slot, signature);
      reportErrorSafely(runtime, info);
    },
    clear(slot) {
      released.delete(slot);
      last.delete(slot);
      heldBack.delete(slot);
    },
    retain(slot) {
      released.delete(slot);
    },
    release(slot) {
      heldBack.delete(slot);
      if (!last.has(slot)) return;
      released.add(slot);
      releasedSinceSettle.add(slot);
    },
    settle(missed = false) {
      for (const slot of missed ? releasedSinceSettle : released) {
        last.delete(slot);
      }
      if (missed) {
        for (const [slot, { runtime, info, signature }] of heldBack) {
          if (!releasedSinceSettle.has(slot) || last.has(slot)) continue;
          last.set(slot, signature);
          reportErrorSafely(runtime, info);
        }
      }
      heldBack.clear();
      released.clear();
      releasedSinceSettle.clear();
    },
  };
}

/** Outside a surface, every failure is reported. */
const UNLOGGED: GenerativeUIFailureLog = {
  report: (runtime, _slot, info) => reportErrorSafely(runtime, info),
  clear: () => {},
  retain: () => {},
  release: () => {},
  settle: () => {},
};

/** The failure log of the surface being rendered; set by `SurfaceView`. */
export const GenerativeUIFailureLogContext =
  createContext<GenerativeUIFailureLog>(UNLOGGED);

export function useFailureLog(): GenerativeUIFailureLog {
  return useContext(GenerativeUIFailureLogContext);
}

/**
 * The slots of a failure log, per node place (one rendered copy of a node,
 * see `placeOf` in SurfaceView) and surface boundary.
 */
export const failureSlots = {
  /** A node's own render failure (its NodeBoundary). */
  node: (place: string) => `node ${place}`,
  /** The app's `errorBoundary.fallback` of a node. */
  appFallback: (place: string) => `app-fallback ${place}`,
  /** The host fallback shown for a node's render failure. */
  renderFallback: (place: string) => `render-fallback ${place}`,
  /**
   * The host fallback shown in place of a node that cannot render: invalid
   * props, unknown type, cyclic reference.
   */
  fallback: (place: string) => `fallback ${place}`,
  /**
   * The host fallback of a cyclic reference. A slot of its own, apart from
   * the fallback of a node that cannot render.
   */
  cycle: (place: string) => `cycle ${place}`,
  /** The invalid props of a node, reported once until they are valid. */
  props: (place: string) => `props ${place}`,
  surface: (level: string) => `surface ${level}`,
  surfaceFallback: (level: string) => `surface-fallback ${level}`,
};

function sameKeys(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

interface FallbackGuardProps {
  surfaceId: string;
  componentId?: string;
  runtime: GenerativeUIRuntime;
  log: GenerativeUIFailureLog;
  slot: string;
  /** What the fallback stands in for, so a new one is a new failure. */
  context: string;
  /**
   * A change of any of these gives a failed fallback another chance: the
   * message it shows and the revision of the node it stands in for.
   */
  resetKeys: readonly unknown[];
  /** Shown instead when the fallback throws. Must not throw itself. */
  replacement?: ReactNode;
  children: ReactNode;
}

/**
 * Wraps an error fallback. The fallback comes from the host or the app, so it
 * may throw too; then this renders `replacement` (nothing by default) and
 * reports the fallback's error, so that the failure stays inside the node
 * instead of reaching its parent, the chat or the host page. It renders no
 * element, so a working fallback looks the same.
 *
 * A failed fallback gets another chance when one of `resetKeys` changes (a
 * new message or a new revision of the node), and when the boundary above
 * it, if any, catches a new error (that remounts it). A fallback that
 * throws the same error again for the same message is not reported again.
 */
interface FallbackGuardState {
  failed: boolean;
  /** What the fallback threw, while `failed`. */
  error?: Error;
  resetKeys: readonly unknown[];
}

class FallbackGuard extends Component<FallbackGuardProps, FallbackGuardState> {
  state: FallbackGuardState = {
    failed: false,
    resetKeys: this.props.resetKeys,
  };

  static getDerivedStateFromError(thrown: unknown) {
    return { failed: true, error: toError(thrown) };
  }

  static getDerivedStateFromProps(
    props: FallbackGuardProps,
    state: FallbackGuardState,
  ): Partial<FallbackGuardState> | null {
    return sameKeys(props.resetKeys, state.resetKeys)
      ? null
      : { failed: false, error: undefined, resetKeys: props.resetKeys };
  }

  private report(error: Error) {
    const { runtime, surfaceId, componentId, log, slot, context } = this.props;
    log.report(
      runtime,
      slot,
      {
        kind: "render",
        surfaceId,
        ...(componentId === undefined ? {} : { componentId }),
        error: fallbackError(error, componentId),
      },
      context,
    );
  }

  componentDidCatch(thrown: unknown) {
    this.report(this.state.error ?? toError(thrown));
  }

  componentDidMount() {
    if (!this.state.failed) {
      this.props.log.clear(this.props.slot);
      return;
    }
    // A remount that kept the failure (<Activity> showing the fallback
    // again) reports it again, as NodeBoundary does: the log drops it as a
    // repeat, unless the surface's content changed meanwhile.
    if (this.state.error) this.report(this.state.error);
  }

  componentDidUpdate() {
    if (!this.state.failed) this.props.log.clear(this.props.slot);
  }

  render() {
    return this.state.failed
      ? (this.props.replacement ?? null)
      : this.props.children;
  }
}

/**
 * The host's `NodeFallback`, guarded: when it throws, the node renders
 * nothing and the error is reported, and the parent node keeps rendering.
 * Every place that shows the host fallback goes through this.
 */
export function GuardedNodeFallback({
  surfaceId,
  componentId,
  runtime,
  message,
  retry,
  slot,
  revision,
}: {
  surfaceId: string;
  /** The failed node, or `undefined` for the whole surface. */
  componentId: string | undefined;
  runtime: GenerativeUIRuntime;
  message: string;
  retry?: () => void;
  /** The failure-log slot of this fallback (see `failureSlots`). */
  slot: string;
  /**
   * The revision of the node shown in its place (its wire props object):
   * a fallback that failed is tried again for a new one.
   */
  revision?: unknown;
}) {
  const { NodeFallback } = useGenerativeUIHost();
  const log = useFailureLog();
  return (
    <FallbackGuard
      surfaceId={surfaceId}
      componentId={componentId}
      runtime={runtime}
      log={log}
      slot={slot}
      context={message}
      resetKeys={[message, revision]}
    >
      <NodeFallback
        message={message}
        componentId={componentId ?? "surface"}
        retry={retry}
      />
    </FallbackGuard>
  );
}

/**
 * Calls the app's `errorBoundary.fallback` in a render of its own, so that
 * the guard above it catches what it throws.
 */
function AppErrorFallback({
  render,
  ...props
}: {
  render: NonNullable<GenerativeUIRuntime["errorFallback"]>;
  error: Error;
  retry: () => void;
  surfaceId: string;
  componentId: string;
}) {
  return <>{render(props)}</>;
}

interface NodeBoundaryProps {
  surfaceId: string;
  componentId: string;
  /**
   * Where this copy of the node is in the surface: the place of its parent,
   * the slot it renders in, its id, and the template item path when it
   * renders inside a template. Names its failure-log slots.
   */
  place: string;
  /** Wire props object of the node; a new object means a new agent revision. */
  revision: unknown;
  runtime: GenerativeUIRuntime;
  log: GenerativeUIFailureLog;
  children: ReactNode;
}

interface NodeBoundaryState {
  /** Always an Error: a thrown value is turned into one (see `toError`). */
  error: Error | null;
  revision: unknown;
}

/**
 * Per-node boundary. Resets on retry or a new agent revision, not on data
 * ticks. A failure that stays the same across revisions is reported once.
 */
export class NodeBoundary extends Component<
  NodeBoundaryProps,
  NodeBoundaryState
> {
  state: NodeBoundaryState = { error: null, revision: this.props.revision };

  static getDerivedStateFromError(thrown: unknown): Partial<NodeBoundaryState> {
    return { error: toError(thrown) };
  }

  static getDerivedStateFromProps(
    props: NodeBoundaryProps,
    state: NodeBoundaryState,
  ): Partial<NodeBoundaryState> | null {
    return props.revision !== state.revision
      ? { error: null, revision: props.revision }
      : null;
  }

  componentDidCatch(thrown: unknown) {
    const { runtime, surfaceId, componentId, log, place } = this.props;
    // A fallback shown in place of the node (invalid props) is gone now.
    log.clear(failureSlots.fallback(place));
    log.report(runtime, failureSlots.node(place), {
      kind: "render",
      surfaceId,
      componentId,
      error: this.state.error ?? toError(thrown),
    });
  }

  private slots() {
    const { place } = this.props;
    return [
      failureSlots.node(place),
      failureSlots.appFallback(place),
      failureSlots.renderFallback(place),
    ];
  }

  private clearSlots() {
    for (const slot of this.slots()) this.props.log.clear(slot);
  }

  componentDidMount() {
    // A remount of the same place (StrictMode, an ancestor that remounts)
    // keeps what the place reported.
    for (const slot of this.slots()) this.props.log.retain(slot);
    if (!this.state.error) {
      this.clearSlots();
      return;
    }
    // A remount that kept the failure (<Activity> showing the node again)
    // reports it again, as an effect that checks props does. The log drops
    // it as a repeat, unless the surface's content changed meanwhile.
    const { runtime, surfaceId, componentId, log, place } = this.props;
    log.report(runtime, failureSlots.node(place), {
      kind: "render",
      surfaceId,
      componentId,
      error: this.state.error,
    });
  }

  componentDidUpdate(prevProps: NodeBoundaryProps) {
    if (prevProps.place !== this.props.place) {
      // Another node in the same element (a single slot that names another
      // id): the old place went away.
      const { log } = this.props;
      log.release(failureSlots.node(prevProps.place));
      log.release(failureSlots.appFallback(prevProps.place));
      log.release(failureSlots.renderFallback(prevProps.place));
      for (const slot of this.slots()) log.retain(slot);
    }
    if (!this.state.error) this.clearSlots();
  }

  componentWillUnmount() {
    for (const slot of this.slots()) this.props.log.release(slot);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { runtime, surfaceId, componentId, place, log } = this.props;
    const hostFallback = (
      <GuardedNodeFallback
        surfaceId={surfaceId}
        componentId={componentId}
        runtime={runtime}
        message={error.message}
        retry={this.retry}
        slot={failureSlots.renderFallback(place)}
      />
    );
    const fallback = runtime.errorFallback;
    if (!fallback) return hostFallback;
    // When the app's fallback throws, the host's one stands in, with Retry.
    return (
      <FallbackGuard
        surfaceId={surfaceId}
        componentId={componentId}
        runtime={runtime}
        log={log}
        slot={failureSlots.appFallback(place)}
        context={error.message}
        resetKeys={[error]}
        replacement={hostFallback}
      >
        <AppErrorFallback
          render={fallback}
          error={error}
          retry={this.retry}
          surfaceId={surfaceId}
          componentId={componentId}
        />
      </FallbackGuard>
    );
  }
}

interface SurfaceBoundaryProps {
  surfaceId: string;
  runtime: GenerativeUIRuntime;
  log: GenerativeUIFailureLog;
  /** Which of the two boundaries of the surface: names its log slots. */
  level: "outer" | "inner";
  /**
   * Changes with each new content of the surface (new operations applied),
   * and not when the same content is delivered again; resets a failure.
   */
  revision: unknown;
  /**
   * Offer Retry in the fallback. The boundary around the host's root offers
   * it: the host's root may fail for a reason of its own that a retry can
   * clear. The one inside the root does not. It catches only failures of
   * the surface's own rendering of its root node, which come back the same
   * until the content changes, so a new content is what resets it; and on
   * the web its fallback stays the output it had before the host existed,
   * with no button.
   */
  retryable?: boolean;
  children: ReactNode;
}

interface SurfaceBoundaryState {
  /** Always an Error: a thrown value is turned into one (see `toError`). */
  error: Error | null;
  revision: unknown;
}

/**
 * Surface boundary: a failure here must not reach the chat or the host page.
 * It resets on a new revision, and on Retry when `retryable`. A failure that
 * stays the same across revisions is reported once.
 */
export class SurfaceBoundary extends Component<
  SurfaceBoundaryProps,
  SurfaceBoundaryState
> {
  state: SurfaceBoundaryState = { error: null, revision: this.props.revision };

  static getDerivedStateFromError(
    thrown: unknown,
  ): Partial<SurfaceBoundaryState> {
    return { error: toError(thrown) };
  }

  static getDerivedStateFromProps(
    props: SurfaceBoundaryProps,
    state: SurfaceBoundaryState,
  ): Partial<SurfaceBoundaryState> | null {
    return props.revision !== state.revision
      ? { error: null, revision: props.revision }
      : null;
  }

  componentDidCatch(thrown: unknown) {
    const { runtime, surfaceId, log, level } = this.props;
    log.report(runtime, failureSlots.surface(level), {
      kind: "render",
      surfaceId,
      error: this.state.error ?? toError(thrown),
    });
  }

  private clearSlots() {
    const { log, level } = this.props;
    log.clear(failureSlots.surface(level));
    log.clear(failureSlots.surfaceFallback(level));
  }

  componentDidMount() {
    if (!this.state.error) this.clearSlots();
  }

  componentDidUpdate() {
    if (!this.state.error) this.clearSlots();
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    // The last boundary of the surface: the guard keeps a fallback that
    // throws from reaching the chat or the host page.
    return (
      <GuardedNodeFallback
        surfaceId={this.props.surfaceId}
        componentId={undefined}
        runtime={this.props.runtime}
        message="this generated UI failed to render"
        retry={this.props.retryable ? this.retry : undefined}
        slot={failureSlots.surfaceFallback(this.props.level)}
      />
    );
  }
}
