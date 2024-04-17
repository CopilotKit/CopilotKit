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
      apiKey="co-6a3a450c20bfdd472af3e83bf40e161cd57f5468b0113317940a631a95ff323a"
      cloudRestrictToTopic={{
        validTopics: ["presentation", "small-talk", "music"],
        invalidTopics: ["math", "science", "history"],
      }}
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
