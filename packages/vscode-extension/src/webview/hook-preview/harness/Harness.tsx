import { Component, Suspense, type ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { RegistryReader } from "./registry-reader";
import { installFetchInterceptor } from "./fetch-interceptor";
import type { CapturedRegistry } from "./registry";

const DUMMY_RUNTIME_URL =
  "https://__copilotkit_hook_preview_mock.local/api";

let interceptorInstalled = false;

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
  v2Access?: { copilotkit?: any } | null;
  V2Provider?: (props: { children: ReactNode }) => ReactNode;
}

export function Harness({
  HostRoot,
  onCapture,
  onMountError,
  v2Access,
  V2Provider,
}: MountArgs) {
  if (!interceptorInstalled) {
    installFetchInterceptor([DUMMY_RUNTIME_URL]);
    interceptorInstalled = true;
  }

  // Wrap BOTH the RegistryReader and the host in the same error boundary so a
  // crash in either flows to `onMountError` rather than bubbling to React's
  // default handler. Keeping them under a single boundary also means a host
  // error prevents a stale registry snapshot from being published.
  const inner = (
    <HarnessBoundary onError={onMountError}>
      <RegistryReader onCapture={onCapture} v2={v2Access} />
      <Suspense fallback={null}>
        <HostRoot />
      </Suspense>
    </HarnessBoundary>
  );

  const body = V2Provider ? <V2Provider>{inner}</V2Provider> : inner;

  return <CopilotKit runtimeUrl={DUMMY_RUNTIME_URL}>{body}</CopilotKit>;
}
