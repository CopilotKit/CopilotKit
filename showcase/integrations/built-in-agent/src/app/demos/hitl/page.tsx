"use client";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { NotSupportedBanner } from "../_components/not-supported-banner";

export default function HITL() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <NotSupportedBanner>
        This demo requires <code>useInterrupt</code> with{" "}
        <code>CUSTOM_EVENT</code>, which the in-process built-in agent runtime
        does not currently emit. See <code>PARITY_NOTES.md</code> for details.
      </NotSupportedBanner>
    </CopilotKitProvider>
  );
}
