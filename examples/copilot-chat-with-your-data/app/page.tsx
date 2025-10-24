"use client";

import { CopilotSidebar } from "@copilotkit/react-ui";
import { Dashboard } from "../components/Dashboard";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { CustomAssistantMessage } from "../components/AssistantMessage";
import { prompt } from "../lib/prompt";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useSearchParams } from "next/navigation";

import { Suspense } from "react";

function HomeContent() {
  const searchParams = useSearchParams();
  const openCopilot = searchParams?.get('openCopilot') === 'true';


  useCopilotReadable({
    description: "Current time",
    value: new Date().toLocaleTimeString(),
  })

  return (
    <>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="w-full max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex-grow">
          <Dashboard />
        </main>
        <Footer />
      </div>
      <CopilotSidebar
        defaultOpen={openCopilot}
        instructions={prompt}
        AssistantMessage={CustomAssistantMessage}
        labels={{
          title: "Data Assistant",
          initial: "Hello, I'm here to help you understand your data. How can I help?",
          placeholder: "Ask about sales, trends, or metrics...",
        }}
      />
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
