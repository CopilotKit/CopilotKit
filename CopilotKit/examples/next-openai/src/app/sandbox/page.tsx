"use client";

import { CopilotKit, useCoAgent, useCoAgentAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { useState } from "react";

export default function PanelPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit/sandbox" agent="email_agent">
      <SandBox />
      <CopilotPopup defaultOpen={true} clickOutsideToClose={false} />
    </CopilotKit>
  );
}

interface EmailAgentState {
  email?: {
    subject: string;
    body: string;
    status: "none" | "pending" | "approved" | "declined";
  };
}

function SandBox() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"none" | "approved" | "declined">("none");
  const { run } = useCoAgent({ name: "email_agent" });

  useCoAgentAction<EmailAgentState>(
    {
      name: "email_agent",
      nodeName: "email_node",
      render: ({ state }) => {
        if (state.email) {
          return (
            <div className="flex flex-col">
              <div>Send this email?</div>
              <div>Subject: {state.email.subject}</div>
              <div>Body: {state.email.body}</div>
              {status === "none" && (
                <div>
                  <button
                    className="bg-red-500"
                    onClick={() => {
                      setStatus("declined");
                      setSubject("");
                      run();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="bg-green-500"
                    onClick={() => {
                      setStatus("approved");
                      setSubject(state.email?.subject || "");
                      run();
                    }}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          );
        }
      },
    },
    [status],
  );

  return (
    <div className="h-full flex text-white flex-col">
      <div>Subject: {subject}</div>
      <div>Body: {body}</div>
    </div>
  );
}
