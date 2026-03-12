"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";

const BookWriter = ({
  respond,
  args,
}: {
  respond: (topic: string) => void;
  args: { topic?: string };
}) => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
        <p className="text-gray-800 font-medium mb-2">
          Write a book about: {args?.topic}
        </p>
        <button
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          onClick={() => {
            respond?.(args?.topic ?? "");
          }}
        >
          Confirm & Start Writing
        </button>
      </div>
    </div>
  );
};

export default function Page() {
  useCopilotChatSuggestions(
    {
      instructions: "Write book on a given topic, suggest random topics",
      minSuggestions: 1,
      maxSuggestions: 3,
    },
    []
  );
  useCopilotAction({
    name: "get-details-before-writing-book",
    description: "Get the details of the book before writing it",
    parameters: [
      {
        name: "topic",
        type: "string",
        description: "The topic of the book",
        required: true,
      },
    ],
    renderAndWaitForResponse: ({ respond, args }) => {
      return <BookWriter respond={respond ?? (() => {})} args={args} />;
    },
    followUp: false,
  });

  useCopilotAction({
    name: "*",
    description: "Handle all other requests",
    renderAndWaitForResponse: ({ respond, args }) => {
      return <pre>{JSON.stringify(args, null, 2)}</pre>;
    },
    followUp: false,
  });

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 h-[calc(100vh-4rem)] overflow-y-auto">
      <CopilotChat
        instructions={
          "You are assisting the user as best as you can. Answer in the best way possible given the data you have."
        }
        labels={{
          title: "Your Assistant",
          initial: "Hi! 👋 How can I assist you today?",
        }}
      />
    </div>
  );
}
