/**
 * CopilotKit chat interface with custom renderCountry action.
 * Demonstrates AG-UI protocol: agent calls frontend tool to render UI components.
 */

import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import ChatCard from "./CountryCard";

export default function MyChat() {
  // Custom CSS to override CopilotKit defaults
  const customStyles = `
    .chat-container {
      height: 100% !important;
      display: flex;
      flex-direction: column;
      overflow: scroll;
      border-radius: 16px !important;
    }

    /* Typography */
    .copilotKitMessages,
    .copilotKitInput,
    .copilotKitUserMessage,
    .copilotKitAssistantMessage,
    .copilotKitMarkdownElement {
      font-family: system-ui, -apple-system, sans-serif !important;
      font-size: 14px !important;
    }

    /* Border radius for message bubbles */
    .copilotKitUserMessage,
    .copilotKitAssistantMessage {
      border-radius: 16px !important;
    }

    /* Padding */
    .copilotKitMessages {
      padding: 8px !important;
    }

    .copilotKitInput {
      padding: 8px !important;
      background-color: #ffffff !important;
    }

    .copilotKitInput input,
    .copilotKitInput textarea,
    .copilotKitInput [contenteditable] {
      background-color: #ffffff !important;
      color: #1f2937 !important;
    }

    .copilotKitChat {
      height: 100% !important;
    }
  `;

  // Register frontend action that the agent can call to render country cards
  useCopilotAction({
    name: "renderCountry",
    description:
      "Render chosen country in the UI with details like capital and flag",
    parameters: [
      {
        name: "countryName",
        type: "string",
        description: "The name of the country to display in the UI",
        required: true,
      },
      {
        name: "capital",
        type: "string",
        description: "The capital city of the country",
        required: false,
      },
      {
        name: "flagEmoji",
        type: "string",
        description:
          "The flag emoji for the country (e.g., 🇺🇸 for United States)",
        required: false,
      },
      {
        name: "points",
        type: "number",
        description: "The number of points awarded for visiting this country",
        required: false,
      },
    ],
    render: ({ args }) => {
      return (
        <ChatCard
          countryName={args.countryName || ""}
          capital={args.capital}
          flagEmoji={args.flagEmoji}
          points={args.points}
        />
      );
    },
  });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: customStyles }} />
      <div
        className="chat-container"
        style={
          {
            "--copilot-kit-primary-color": "#cdcdcd",
            "--copilot-kit-contrast-color": "#000000",
            "--copilot-kit-background-color": "#ffffff",
            "--copilot-kit-secondary-color": "#f3f4f6",
            "--copilot-kit-secondary-contrast-color": "#1f2937",
            "--copilot-kit-separator-color": "#e5e7eb",
            "--copilot-kit-muted-color": "#9ca3af",
          } as CopilotKitCSSProperties
        }
      >
        <CopilotChat
          labels={{
            title: "My Assistant",
            initial: "Where should we go next?",
            placeholder: "Where next?",
          }}
        />
      </div>
    </>
  );
}
