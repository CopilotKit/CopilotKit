"use client";

import { CopilotSidebar, useAgentContext } from "@copilotkit/react-core/v2";
import { Dashboard } from "../components/Dashboard";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { CustomAssistantMessage } from "../components/AssistantMessage";
import { Suspense } from "react";

function HomeContent() {
  useAgentContext({
    description: "Current time",
    value: new Date().toLocaleTimeString(),
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className="w-full max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex-grow">
        <Dashboard />
      </main>
      <Footer />
      <CopilotSidebar
        defaultOpen
        messageView={{ assistantMessage: CustomAssistantMessage }}
        labels={{
          modalHeaderTitle: "Data Assistant",
          welcomeMessageText:
            "Hello, I'm here to help you understand your data. How can I help?",
          chatInputPlaceholder: "Ask about sales, trends, or metrics...",
        }}
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
