import React, { Component, Suspense, useMemo } from "react";
import type { ReactNode } from "react";
import { reportErrorSafely } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";

type HostFallbackRender = NonNullable<GenerativeUIRuntime["errorFallback"]>;
type HostFallbackProps = Parameters<HostFallbackRender>[0];

const noRetry = () => {};

export function DefaultNodeFallback({
  message,
  componentId,
  retry,
}: {
  message: string;
  componentId: string;
  retry?: () => void;
}) {
  return (
    <div
      role="alert"
      data-generative-ui-error={componentId}
      style={{
        border: "1px solid #fca5a5",
        background: "#fef2f2",
        color: "#991b1b",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
      }}
    >
      Couldn’t display this part: {message}
      {retry && (
        <button
          type="button"
          onClick={retry}
          style={{ marginLeft: 8, textDecoration: "underline" }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Calls the host fallback from a component of its own, so a fallback that
 * uses hooks never adds them to the node that renders it.
 */
function HostFallback({
  render,
  ...props
}: HostFallbackProps & { render: HostFallbackRender }) {
  return <>{render(props)}</>;
}

const fallbackKeys = new WeakMap<HostFallbackRender, number>();
let lastFallbackKey = 0;

/**
 * One key per host fallback function, so a new function mounts afresh
 * instead of inheriting the hooks of the one it replaces.
 */
function fallbackKey(render: HostFallbackRender): number {
  let key = fallbackKeys.get(render);
  if (key === undefined) {
    key = ++lastFallbackKey;
    fallbackKeys.set(render, key);
  }
  return key;
}

interface HostFallbackBoundaryProps {
  runtime: GenerativeUIRuntime;
  surfaceId: string;
  componentId: string;
  /** The node's failure; a new one gives the host fallback another try. */
  failure: Error;
  /** The text of the default fallback shown if the host fallback throws. */
  message: string;
  retry?: () => void;
  children: ReactNode;
}

interface HostFallbackBoundaryState {
  error: Error | null;
  failure: Error;
}

/**
 * A host fallback that throws is reported and replaced by the default for
 * its node only, so the rest of the surface keeps working and the failure
 * it stood in for is still reported.
 */
class HostFallbackBoundary extends Component<
  HostFallbackBoundaryProps,
  HostFallbackBoundaryState
> {
  state: HostFallbackBoundaryState = {
    error: null,
    failure: this.props.failure,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<HostFallbackBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: HostFallbackBoundaryProps,
    state: HostFallbackBoundaryState,
  ): Partial<HostFallbackBoundaryState> | null {
    return props.failure !== state.failure
      ? { error: null, failure: props.failure }
      : null;
  }

  componentDidCatch(error: Error) {
    const { runtime, surfaceId, componentId } = this.props;
    reportErrorSafely(runtime, {
      kind: "render",
      surfaceId,
      componentId,
      error,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { message, componentId, retry } = this.props;
    return (
      <DefaultNodeFallback
        message={message}
        componentId={componentId}
        retry={retry}
      />
    );
  }
}

/**
 * What a node shows instead of its component: the host's
 * `errorBoundary.fallback` when it has one, else the default. Takes the
 * `error`, or the `reason` to build one from, once per mount, so a healthy
 * node allocates nothing and the host gets the same error on each render.
 */
export function NodeFallback({
  runtime,
  kind,
  error,
  reason,
  surfaceId,
  componentId,
  retry,
  message,
}: Omit<HostFallbackProps, "error" | "retry"> &
  ({ error: Error; reason?: never } | { error?: never; reason: string }) & {
    runtime: GenerativeUIRuntime;
    /** Only a render failure can be retried. */
    retry?: () => void;
    /** The text of the default fallback, when it is not the error message. */
    message?: string;
  }) {
  const nodeError = useMemo(() => error ?? new Error(reason), [error, reason]);
  const fallback = runtime.errorFallback;
  const defaultMessage = message ?? nodeError.message;
  if (!fallback) {
    return (
      <DefaultNodeFallback
        message={defaultMessage}
        componentId={componentId}
        retry={retry}
      />
    );
  }
  return (
    <HostFallbackBoundary
      key={fallbackKey(fallback)}
      runtime={runtime}
      failure={nodeError}
      surfaceId={surfaceId}
      componentId={componentId}
      message={defaultMessage}
      retry={retry}
    >
      {/* A fallback that suspends shows nothing for this node while it
          loads, and the node and the rest of the surface commit without
          waiting for it, so the failure is reported on time. */}
      <Suspense fallback={null}>
        <HostFallback
          render={fallback}
          kind={kind}
          error={nodeError}
          retry={retry ?? noRetry}
          surfaceId={surfaceId}
          componentId={componentId}
        />
      </Suspense>
    </HostFallbackBoundary>
  );
}

/**
 * A child that has not streamed yet renders nothing. The prose keeps
 * streaming above the surface, and each component appears as soon as it is
 * complete. A grey block in its place would read as a broken layout.
 */
export function NodePlaceholder(_props: { componentId: string }) {
  return null;
}

interface NodeBoundaryProps {
  surfaceId: string;
  componentId: string;
  /** Wire props object of the node; a new object means a new agent revision. */
  revision: unknown;
  runtime: GenerativeUIRuntime;
  children: ReactNode;
}

interface NodeBoundaryState {
  error: Error | null;
  revision: unknown;
}

/** Per-node boundary. Resets on retry or a new agent revision, not on data ticks. */
export class NodeBoundary extends Component<
  NodeBoundaryProps,
  NodeBoundaryState
> {
  state: NodeBoundaryState = { error: null, revision: this.props.revision };

  static getDerivedStateFromError(error: Error): Partial<NodeBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: NodeBoundaryProps,
    state: NodeBoundaryState,
  ): Partial<NodeBoundaryState> | null {
    return props.revision !== state.revision
      ? { error: null, revision: props.revision }
      : null;
  }

  componentDidCatch(error: Error) {
    const { runtime, surfaceId, componentId } = this.props;
    reportErrorSafely(runtime, {
      kind: "render",
      surfaceId,
      componentId,
      error,
    });
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { runtime, surfaceId, componentId } = this.props;
    return (
      <NodeFallback
        runtime={runtime}
        kind="render"
        error={error}
        surfaceId={surfaceId}
        componentId={componentId}
        retry={this.retry}
      />
    );
  }
}

/**
 * Outer boundary: a failure here must not reach the chat or the host page.
 * It keeps the default fallback: a failure here is outside any component.
 */
export class SurfaceBoundary extends Component<
  { surfaceId: string; runtime: GenerativeUIRuntime; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportErrorSafely(this.props.runtime, {
      kind: "render",
      surfaceId: this.props.surfaceId,
      error,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <DefaultNodeFallback
        message="this generated UI failed to render"
        componentId="surface"
      />
    );
  }
}
