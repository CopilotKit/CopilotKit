"use client";
import { CopilotKit, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import React, { CSSProperties, useState } from "react";
import "@copilotkit/react-textarea/styles.css";
import "@copilotkit/react-ui/styles.css";

function InsideHome() {
  const [message, setMessage] = useState("Hello World!");

  useCopilotReadable({
    description: "This is the current message",
    value: message,
  });
  useCopilotAction(
    {
      name: "displayMessage",
      description: "Display a message.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The message to display.",
          required: true,
        },
      ],
      handler: async ({ message }) => {
        setMessage(message);
      },
      render: (props) => {
        return (
          <div style={{ backgroundColor: "black", color: "white" }}>
            <div>Status: {props.status}</div>
            <div>Message: {props.args.message}</div>
          </div>
        );
      },
    },
    [],
  );
  return (
    <>
      <div>{message}</div>
    </>
  );
}
export default function Home() {
  return (
    <div
      style={
        {
          height: `100vh`,
          "--copilot-kit-primary-color": "red",
        } as CSSProperties
      }
    >
      <CopilotKit runtimeUrl="/api/copilotkit/openai">
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            title: "Presentation Copilot",
            initial: "Hi you! 👋 I can give you a presentation on any topic.",
          }}
          icons={{
            sendIcon: "📩",
          }}
        >
          <InsideHome />
        </CopilotSidebar>
      </CopilotKit>
    </div>
  );
}
