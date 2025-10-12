"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";

export default function Home() {
  return (
    <CopilotKit publicApiKey="<replace_with_your_own>">
      <div className="flex h-screen bg-gray-50">
        <div className="flex-1 flex flex-col">
          <header className="bg-white shadow-sm border-b px-6 py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Vercel AI SDK Starter
            </h1>
            <p className="text-gray-600 mt-1">
              A simple starter application with CopilotKit and Vercel AI SDK
            </p>
          </header>
          <div className="flex-1 p-6">
            <CopilotChat
              instructions="You are a helpful AI assistant with access to weather information. You can help users get weather updates for any location."
              className="h-full rounded-lg border bg-white shadow-sm"
            />
          </div>
        </div>
      </div>
    </CopilotKit>
  );
}
