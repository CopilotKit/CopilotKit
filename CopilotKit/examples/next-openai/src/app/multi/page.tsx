"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "./styles.css";
import { CopilotKit, useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { useSearchParams } from "next/navigation";
import { MessageRole, TextMessage } from "@copilotkit/runtime-client-gql";

export default function PanelPage() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    searchParams.get("runtimeUrl") || `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
  const publicApiKey = searchParams.get("publicApiKey");
  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    publicApiKey: publicApiKey || undefined,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <TravelPlanner />
    </CopilotKit>
  );
}

function TravelPlanner() {
  const { appendMessage } = useCopilotChat();

  // regular action
  useCopilotAction({
    name: "getFlight",
    followUp: false,
    render() {
      return <div>Flight</div>;
    },
  });

  // backend action
  useCopilotAction({
    name: "getImageUrl",
    followUp: true,
    render() {
      return <div>Image</div>;
    },
  });

  // hitl action 1
  useCopilotAction({
    name: "getWeather",
    renderAndWaitForResponse({ status, respond }) {
      return (
        <div className="flex flex-col gap-2 bg-blue-500/50 p-4 border border-blue-500 rounded-md w-1/2">
          <p>Weather</p>
          <p>Status: {status}</p>
          {status !== "complete" && (
            <button
              className="bg-blue-500 text-white p-2 rounded-md"
              onClick={() => respond?.("the weather is 70 degrees")}
            >
              Continue
            </button>
          )}
        </div>
      );
    },
  });

  // hitl action 2
  useCopilotAction({
    name: "getHotel",
    renderAndWaitForResponse({ status, args, respond }) {
      return (
        <div className="flex flex-col gap-2 bg-blue-500/50 p-4 border border-blue-500 rounded-md w-1/2">
          <p>Hotel</p>
          <p>Status: {status}</p>
          {status !== "complete" && (
            <button
              className="bg-blue-500 text-white p-2 rounded-md"
              onClick={() => respond?.("Marriott")}
            >
              Continue
            </button>
          )}
        </div>
      );
    },
  });

  // add a message with followUp false
  useCopilotAction({
    name: "addMessage",
    followUp: false,
    render() {
      return (
        <div className="flex flex-col gap-2 bg-blue-500/50 p-4 border border-blue-500 rounded-md w-1/2">
          <p>Adding a message...</p>
        </div>
      );
    },
    handler: async () => {
      appendMessage(
        new TextMessage({
          role: MessageRole.Assistant,
          content: "What is the weather in San Francisco?",
        }),
        {
          followUp: false,
        },
      );
    },
  });

  return (
    <div className="w-screen h-screen flex items-center justify-center">
      <CopilotChat
        className="w-4/5 h-4/5 border p-4 rounded-xl border-gray-200"
        labels={{
          initial: "Hi you! 👋 Let's book your next vacation. Ask me anything.",
        }}
        instructions="You are a travel planner. You help the user plan their vacation. After presenting something, don't summarize, but keep the reply short."
      />
      {/* 
          ----------------------------------------------------------------
            Buttons for triggering different cases 
          ----------------------------------------------------------------
        */}
      <div className="flex flex-col gap-2 px-4">
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={() =>
            appendMessage(
              new TextMessage({
                role: MessageRole.User,
                content: "Get the weather 3 times all at once, you decide everything.",
              }),
              {},
            )
          }
        >
          Multiple of the same action
        </button>
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={() =>
            appendMessage(
              new TextMessage({
                role: MessageRole.User,
                content: "Get the weather and the hotel all at once, you decide everything.",
              }),
              {},
            )
          }
        >
          Multiple different actions
        </button>
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={() =>
            appendMessage(
              new TextMessage({
                role: MessageRole.User,
                content: "Get the weather, hotel and flight all at once, you decide everything.",
              }),
              {},
            )
          }
        >
          Multiple HITL actions and non-hitl actions
        </button>
        <button
          className="bg-blue-500 text-white p-2 rounded-md"
          onClick={() =>
            appendMessage(
              new TextMessage({
                role: MessageRole.User,
                content: "Add a message, you choose",
              }),
            )
          }
        >
          Add a message
        </button>
      </div>
    </div>
  );
}
