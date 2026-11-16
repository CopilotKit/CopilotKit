"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { HashBrownDemo } from "../_shared/hashbrown/hashbrown-demo";

// The same page as declarative-hashbrown, at the path that the crewai
// integrations serve, with its own runtime and agent id.
export default function ByocHashbrownDemoPage() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("byoc-hashbrown")}
      agent="byoc-hashbrown-demo"
    >
      <HashBrownDemo />
    </CopilotKit>
  );
}
