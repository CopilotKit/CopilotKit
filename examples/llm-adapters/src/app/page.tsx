"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";;
import { providers, providerKeys } from "./llm-providers";
import { useState } from "react";

const runtimeUrl = process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL;

export default function Home() {

  const [selectedProvider, setSelectedProvider] = useState<string>("openai");

  const publicApiKey = providerKeys.find((provider) => provider.id === selectedProvider)?.publicApiKey;

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="flex flex-col items-center w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-4">LLM Adapter</h1>
          <p className="text-gray-600 mb-6">Select an LLM provider to use:</p>
          <div className="flex justify-center">
            <select 
              value={selectedProvider} 
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-[280px] mb-4 border rounded p-2"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="w-full">
          <CopilotKit runtimeUrl={runtimeUrl} publicApiKey={publicApiKey}> 
            <CopilotChat
              instructions={"You are assisting the user as best as you can. Answer in the best way possible given the data you have."}
              labels={{
                title: "Your Assistant",
                initial: "Hi! 👋 How can I assist you today?",
              }}
            />
          </CopilotKit>
        </div>
      </div>
    </div>
  );
}
