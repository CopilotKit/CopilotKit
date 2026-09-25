"use client";

import { useState } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useFrontendToolInterrupts } from "./frontend-tool-interrupts";
import { useConfirmActionTool, useShowGraphTool } from "./tools";

export default function Page() {
  const [graphRuns, setGraphRuns] = useState(0);

  // Once per agent: forwards every frontend tool result to its interrupt.
  useFrontendToolInterrupts();

  // Your tools, registered as usual (with followUp: false).
  useShowGraphTool(() => setGraphRuns((n) => n + 1));
  useConfirmActionTool();

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #eee", fontSize: 13 }}>
        show_graph handler runs: <b>{graphRuns}</b> · try: “what time is it,
        chart 3 5 2 8, and ask me to confirm deleting the file — all in one
        turn”
      </div>
      <CopilotChat agentId="default" style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
