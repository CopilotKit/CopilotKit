"use client";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Error boundary used by {@link InspectorSandboxHost}.
 *
 * Catches synchronous render errors inside `tool.render(args)` and forwards a
 * structured payload to the parent over `postMessage`. The parent overlays the
 * message in the iframe area rather than letting the iframe go blank.
 *
 * The boundary is intentionally bare — no UI of its own beyond a single-line
 * fallback. The studio is responsible for rendering the actual error overlay
 * because it has the full layout context (theme, placement, retry affordance).
 *
 * Spec: .chalk/plans/web-inspector-v1.md §6.5
 */
export interface SandboxErrorBoundaryProps {
  children: ReactNode;
  /**
   * Called with the structured error payload as soon as the boundary catches.
   * The default implementation in {@link InspectorSandboxHost} forwards this
   * over `window.parent.postMessage`.
   */
  onError: (payload: { message: string; stack?: string }) => void;
  /**
   * Optional fallback to render in place of the crashing tool. Defaults to a
   * minimal placeholder. The parent's overlay typically covers this anyway.
   */
  fallback?: ReactNode;
}

interface SandboxErrorBoundaryState {
  error: { message: string; stack?: string } | null;
}

export class SandboxErrorBoundary extends Component<
  SandboxErrorBoundaryProps,
  SandboxErrorBoundaryState
> {
  constructor(props: SandboxErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): SandboxErrorBoundaryState {
    return {
      error: normalizeError(error),
    };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // `getDerivedStateFromError` already populated state — we only call the
    // onError side-effect here so it runs once per error, not on subsequent
    // commits where state is already set.
    try {
      this.props.onError(normalizeError(error));
    } catch {
      // The onError callback itself threw. Swallow — there is no parent to
      // report to and re-throwing would unmount the boundary.
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || "Render error",
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
