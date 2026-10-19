import React, { Component } from "react";
import type { ReactNode } from "react";
import { reportErrorSafely } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";

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

export function NodePlaceholder({ componentId }: { componentId: string }) {
  return (
    <div
      data-generative-ui-placeholder={componentId}
      aria-busy="true"
      style={{ minHeight: 32, borderRadius: 8, background: "#f3f4f6" }}
    />
  );
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
    const fallback = runtime.errorFallback;
    return fallback ? (
      fallback({ error, retry: this.retry, surfaceId, componentId })
    ) : (
      <DefaultNodeFallback
        message={error.message}
        componentId={componentId}
        retry={this.retry}
      />
    );
  }
}

/** Outer boundary: a failure here must not reach the chat or the host page. */
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
