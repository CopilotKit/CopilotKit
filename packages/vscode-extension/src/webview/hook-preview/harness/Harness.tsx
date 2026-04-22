import { Component, Suspense, type ReactNode } from "react";
import { RegistryReader } from "./registry-reader";
import type { CapturedRegistry } from "./registry";

class HarnessBoundary extends Component<
  { onError: (err: unknown) => void; children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

export interface MountArgs {
  HostRoot: () => ReactNode;
  onCapture: (registry: CapturedRegistry) => void;
  onMountError: (err: unknown) => void;
}

/**
 * Mounts the user's source component under our error boundary and reads back
 * the hook configs captured by the runtime stubs
 * (`../copilotkit-stubs.ts`). No real `@copilotkit/react-core` is involved —
 * `CopilotKit` / `CopilotKitProvider` render as Fragments via the stub, and
 * every hook is a capture-only noop. This is the tradeoff the user asked for:
 * preview the render prop + let the form drive its arguments; skip the full
 * runtime.
 */
export function Harness({ HostRoot, onCapture, onMountError }: MountArgs) {
  return (
    <HarnessBoundary onError={onMountError}>
      <RegistryReader onCapture={onCapture} />
      <Suspense fallback={null}>
        <HostRoot />
      </Suspense>
    </HarnessBoundary>
  );
}
