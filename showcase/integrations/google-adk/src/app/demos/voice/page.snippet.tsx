// Docs-only snippet. The live demo route uses page.tsx plus VoiceChat so it
// can include the deterministic sample-audio button for tests. This file gives
// the Voice docs a minimal, copy-pasteable chat surface without requiring
// readers to know about that demo wrapper.
//
// The demo-content bundler walks sibling files in the demo folder and extracts
// region markers from each. See showcase/scripts/bundle-demo-content.ts.

// @region[voice-page]
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core";

export default function VoicePage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-voice"
      agentId="voice-demo"
      useSingleEndpoint={false}
    >
      <CopilotChat />
    </CopilotKitProvider>
  );
}
// @endregion[voice-page]
