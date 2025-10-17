"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import DemoList from "@/components/demo-list/demo-list";

export default function Home() {
  return (
    <CopilotKit publicApiKey="<replace_with_your_own>">
      <div className="flex h-screen bg-gray-50">
        <div className="flex-1 flex flex-col">
          <header className="bg-white shadow-sm border-b px-6 py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Vercel AI SDK Feature Viewer
            </h1>
            <p className="text-gray-600 mt-1">
              Explore advanced features and examples with CopilotKit and Vercel AI SDK
            </p>
          </header>
          <div className="flex-1 p-6">
            <DemoList />
          </div>
        </div>
      </div>
    </CopilotKit>
  );
}
