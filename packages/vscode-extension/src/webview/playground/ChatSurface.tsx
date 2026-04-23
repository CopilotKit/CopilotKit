import * as React from "react";
import type { PlaygroundBundleExports } from "./bundle-loader";

/**
 * Renders the bundled provider chain + HooksAggregator (from the runtime
 * subprocess bundle) and embeds the v2 <CopilotChat> inside it. CopilotChat
 * is resolved at runtime from window.__copilotkit_deps.copilotkitStubs —
 * the forwarding-stubs module forwards it from the real v2 package.
 *
 * The bundle's PlaygroundEntry renders its own `<CopilotKitProvider
 * runtimeUrl={spawnedRuntimeUrl}>…</CopilotKitProvider>`. We render
 * <CopilotChat /> as a sibling inside the Surface so it inherits the
 * provider context — React's context lookup in an IIFE bundle ends at the
 * bundle's root, so we rely on the bundle itself having mounted the chat
 * component INSIDE its provider tree. If chat appears but doesn't connect,
 * this is the layer to revisit.
 */
interface Props {
  bundle: PlaygroundBundleExports;
}

export function ChatSurface({ bundle }: Props): React.JSX.Element {
  const deps = (
    window as { __copilotkit_deps?: Record<string, unknown> }
  ).__copilotkit_deps;
  const CopilotChat = (
    deps?.copilotkitStubs as { CopilotChat?: React.ComponentType } | undefined
  )?.CopilotChat;

  return (
    <section className="playground-chat">
      <bundle.PlaygroundEntry />
      {CopilotChat ? (
        <div className="playground-chat-view">
          <CopilotChat />
        </div>
      ) : (
        <p className="muted">
          Chat UI unavailable — the v2 CopilotChat component isn&apos;t exposed
          to the bundle. Check forwarding-stubs.ts.
        </p>
      )}
    </section>
  );
}
