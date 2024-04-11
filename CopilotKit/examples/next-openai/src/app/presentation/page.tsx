"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "./styles.css";
import { Presentation } from "./components/main/Presentation";
import { useState } from "react";

export default function AIPresentation() {
  const [performResearch, setPerformResearch] = useState(false);

  return (
    <CopilotKit
      url="/api/copilotkit/presentation"
      apiKey="co-269299cf2f18a87b981df61ff4d9162fc2f45ff710ce89baf46e7f678ec60fbd"
    >
      <CopilotSidebar
        instructions={
          "Help the user create and edit a powerpoint-style presentation." +
          (!performResearch
            ? " No research is needed. Do not perform any research."
            : " Perform research on the topic.")
        }
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can help you create a presentation on any topic.",
        }}
        clickOutsideToClose={false}
      >
        <Presentation performResearch={performResearch} setPerformResearch={setPerformResearch} />
      </CopilotSidebar>
    </CopilotKit>
  );
}
