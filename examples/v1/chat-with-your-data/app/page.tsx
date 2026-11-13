"use client";

import { CopilotSidebar, useAgentContext } from "@copilotkit/react-core/v2";
import { Dashboard } from "../components/Dashboard";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { CustomAssistantMessage } from "../components/AssistantMessage";
import { Suspense, useEffect, useState } from "react";
import { startCurrentTimeUpdates } from "../lib/current-time.mjs";

function CurrentTimeContext() {
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString(),
  );

  useEffect(
    () =>
      startCurrentTimeUpdates(() => {
        setCurrentTime(new Date().toLocaleTimeString());
      }),
    [],
  );

  useAgentContext({
    description: "Current time",
    value: currentTime,
  });

  return null;
}

function HomeContent() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <CurrentTimeContext />
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
        <div
          className="min-h-screen bg-gray-50 flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div
            className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"
            aria-hidden="true"
          />
          <span className="sr-only">Loading dashboard...</span>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
