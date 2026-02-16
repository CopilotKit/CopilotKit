"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "./styles.css";
import {
  CopilotKit,
  useCopilotAction,
  useCopilotChat,
} from "@copilotkit/react-core";
import { useSearchParams } from "next/navigation";
import {
  MessageRole,
  TextMessage,
  Message,
} from "@copilotkit/runtime-client-gql";
import { randomId } from "@copilotkit/shared";

const testMessages = [
  {
    name: "Multiple of the same action",
    message:
      "Get the weather 3 times all at once, you decide everything. Do not ask me for anything. At the end, tell me what the weather was between them.",
  },
  {
    name: "Multiple different actions",
    message:
      "Get the weather and the hotel all at once, you decide everything. Do not ask me for anything. At the end, tell me what the weather and hotel was.",
  },
  {
    name: "Multiple HITL actions and non-hitl actions",
    message:
      "Get the weather, hotel and flight all at once, you decide everything. Do not ask me for anything.",
  },
  {
    name: "Add a message",
    message: "Add a message via your tool. Do not ask me for anything.",
  },
];

export default function PanelPage() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    searchParams.get("runtimeUrl") ||
    `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
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
        <div className="flex w-1/2 flex-col gap-2 rounded-md border border-blue-500 bg-blue-500/50 p-4">
          <p>Weather</p>
          <p>Status: {status}</p>
          {status !== "complete" && (
            <button
              className="rounded-md bg-blue-500 p-2 text-white"
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
        <div className="flex w-1/2 flex-col gap-2 rounded-md border border-blue-500 bg-blue-500/50 p-4">
          <p>Hotel</p>
          <p>Status: {status}</p>
          {status !== "complete" && (
            <button
              className="rounded-md bg-blue-500 p-2 text-white"
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
        <div className="flex w-1/2 flex-col gap-2 rounded-md border border-blue-500 bg-blue-500/50 p-4">
          <p>Adding a message...</p>
        </div>
      );
    },
    handler: async () => {
      appendMessage(
        new TextMessage({
          id: randomId(),
          role: MessageRole.Assistant,
          content: "What is the weather in San Francisco?",
        }),
        { followUp: false },
      );
    },
  });

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <CopilotChat
        className="h-4/5 w-4/5 rounded-xl border border-gray-200 p-4"
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
        {testMessages.map((testMessage) => (
          <div key={testMessage.name}>
            <button
              className="rounded-md bg-blue-500 p-2 text-white"
              onClick={() =>
                appendMessage(
                  new TextMessage({
                    id: randomId(),
                    role: MessageRole.User,
                    content: testMessage.message,
                  }),
                )
              }
            >
              {testMessage.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
