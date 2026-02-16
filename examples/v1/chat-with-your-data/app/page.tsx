"use client";

import { CopilotSidebar } from "@copilotkit/react-ui";
import { Dashboard } from "../components/Dashboard";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { CustomAssistantMessage } from "../components/AssistantMessage";
import { prompt } from "../lib/prompt";
import { useCopilotReadable } from "@copilotkit/react-core";

import { Suspense } from "react";

function HomeContent() {
  useCopilotReadable({
    description: "Current time",
    value: new Date().toLocaleTimeString(),
  });

  return (
    <>
      <CopilotSidebar
        defaultOpen
        instructions={prompt}
        AssistantMessage={CustomAssistantMessage}
        labels={{
          title: "Data Assistant",
          initial:
            "Hello, I'm here to help you understand your data. How can I help?",
          placeholder: "Ask about sales, trends, or metrics...",
        }}
      >
        <div className="flex min-h-screen flex-col bg-gray-50">
          <Header />
          <main className="mx-auto w-full max-w-7xl flex-grow px-4 py-6 sm:px-6 lg:px-8">
            <Dashboard />
          </main>
          <Footer />
        </div>
      </CopilotSidebar>
    </>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500"></div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
