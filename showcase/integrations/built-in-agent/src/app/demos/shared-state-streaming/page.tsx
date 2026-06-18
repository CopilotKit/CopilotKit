"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { NotSupportedBanner } from "../_components/not-supported-banner";

export default function SharedStateStreaming() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <NotSupportedBanner>
        This demo requires per-token state deltas (
        <code>AGUISendStateDelta</code>), which the in-process built-in agent
        runtime does not currently emit. See <code>PARITY_NOTES.md</code> for
        details.
      </NotSupportedBanner>
    </CopilotKitProvider>
  );
}
