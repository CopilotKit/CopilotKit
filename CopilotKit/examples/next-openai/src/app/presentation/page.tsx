"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "./styles.css";
import { Presentation } from "./components/main/Presentation";
import { useState } from "react";

export default function AIPresentation() {
  const [performResearch, setPerformResearch] = useState(false);

  return (
    <CopilotKit url="/api/copilotkit/presentation">
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
        initialSuggestions={[
          {
            title: "Make a presentation about AI",
            message: "Make a new presentation about AI by updating the current slide.",
          },
          {
            title: "Create another slide",
            message: "Create another slide based on the current one",
          },
          {
            title: "Research CopilotKit",
            message: "Research CopilotKit and make 5 slides about it.",
          },
        ]}
        autoSuggest={true}
      >
        <Presentation performResearch={performResearch} setPerformResearch={setPerformResearch} />
      </CopilotSidebar>
    </CopilotKit>
  );
}
