import * as React from "react";
import type { PlaygroundBundleExports } from "./bundle-loader";

/**
 * Renders the bundle's ChatPlayground export, which is the provider chain
 * wrapped around both HooksAggregator AND CopilotChat. Because the provider
 * and CopilotChat are both resolved inside the bundle from the same module
 * instance (forwarding-stubs → real v2), React context flows correctly and
 * the chat connects to the spawned runtime.
 */
interface Props {
  bundle: PlaygroundBundleExports;
}

export function ChatSurface({ bundle }: Props): React.JSX.Element {
  return (
    <section className="playground-chat">
      <bundle.ChatPlayground />
    </section>
  );
}
