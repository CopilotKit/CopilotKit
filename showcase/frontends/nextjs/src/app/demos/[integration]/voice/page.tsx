"use client";

// @region[voice-page]
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { VoiceChat } from "./voice-chat";

export default function VoiceDemoPage() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("voice")}
      agent="voice-demo"
      useSingleEndpoint={false}
      // The dev-only `<cpk-web-inspector>` overlay turns on for localhost
      // and covers the sample-audio button, so Playwright cannot click it in
      // local runs. Production is not localhost and never shows it. Turning
      // it off here makes the demo behave the same everywhere.
      enableInspector={false}
    >
      <VoiceChat />
    </CopilotKit>
  );
}
// @endregion[voice-page]
