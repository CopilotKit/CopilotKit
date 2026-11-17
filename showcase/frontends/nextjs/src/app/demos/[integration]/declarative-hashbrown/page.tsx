"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { HashBrownDemo } from "../_shared/hashbrown/hashbrown-demo";

export default function DeclarativeHashbrownDemoPage() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("declarative-hashbrown")}
      agent="declarative-hashbrown-demo"
    >
      <HashBrownDemo />
    </CopilotKit>
  );
}
