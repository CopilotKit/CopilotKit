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
      apiKey="co-db6fe9ddcd91e5466b6fc3e55f981d8d250b2f6dff9c7f640da4249f8534c2fd"
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
