"use client";

import { CopilotKitProvider } from "@copilotkit/react-core";
import { VoiceChat } from "./voice-chat";

export default function VoiceDemoPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-voice"
      agentId="voice-demo"
      useSingleEndpoint={false}
      // The dev-only `<cpk-web-inspector>` overlay (auto-enabled on
      // localhost via shouldShowDevConsole) intercepts pointer events
      // on top of the voice sample-audio button, so dev/D5 probe runs
      // can't click it through Playwright. Production isn't localhost
      // so the inspector never mounts there — voice is D5 in prod and
      // D4 locally for this reason alone. Disable explicitly here so
      // the demo behaves the same in both environments.
      enableInspector={false}
    >
      <VoiceChat />
    </CopilotKitProvider>
  );
}
