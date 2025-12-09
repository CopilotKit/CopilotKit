import type { MetaFunction } from "@remix-run/node";
import { CopilotKit, useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotTextarea } from "@copilotkit/react-textarea";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useState } from "react";
import "@copilotkit/react-textarea/styles.css";
import "@copilotkit/react-ui/styles.css";

export const meta: MetaFunction = () => {
  return [{ title: "New Remix App" }, { name: "description", content: "Welcome to Remix!" }];
};

function InsideHome() {
  const [message, setMessage] = useState("Hello World!");
  const [text, setText] = useState("");
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
      <CopilotTextarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autosuggestionsConfig={{
          textareaPurpose: "an outline of a presentation about elephants",
          chatApiConfigs: {},
        }}
      />
    </>
  );
}

export default function Index() {
  return (
    <CopilotKit runtimeUrl="/copilotkit">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can give you a presentation on any topic.",
        }}
      >
        <InsideHome />
      </CopilotSidebar>
    </CopilotKit>
  );
}
