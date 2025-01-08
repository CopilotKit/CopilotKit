"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { useState } from "react";

export default function Home() {
  return (
    <>
      <YourMainContent />
      <CopilotPopup
        defaultOpen={true}
        labels={{
          title: "Popup Assistant",
          initial: "Need any help?",
        }}
      />
    </>
  );
}

function YourMainContent() {
  const [backgroundColor, setBackgroundColor] = useState("#ADD8E6");
  useCopilotAction({
    name: "setBackgroundColor",
    parameters: [
      {
        name: "backgroundColor",
        description:
          "The background color to set. Make sure to pick nice colors.",
      },
    ],
    handler({ backgroundColor }) {
      setBackgroundColor(backgroundColor);
    },
  });
  return (
    <div
      style={{ backgroundColor }}
      className="h-screen w-screen flex justify-center items-center text-2xl"
    >
      Your main content
    </div>
  );
}
