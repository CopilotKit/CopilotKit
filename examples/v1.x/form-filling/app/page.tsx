"use client";

import { CopilotPopup } from "@copilotkit/react-ui";
import { IncidentReportForm } from "@/components/IncidentReportForm";
import { prompt } from "@/lib/prompt";
import { useCopilotReadable } from "@copilotkit/react-core";
import { retrieveUserInfo } from "@/lib/user-info";

export default function Home() {
  useCopilotReadable({
    description: "The current user information",
    value: retrieveUserInfo(),
  })

  return (
    <div className="min-h-screen p-8 pb-20 sm:p-12 font-[family-name:var(--font-geist-sans)]">
      <CopilotPopup
        instructions={prompt}
        defaultOpen
        labels={{
          title: "✨ Incident Report Assistant",
          initial: [
            "I'm an AI assistant built for guiding you through filing incident reports. How can I help?",
          ],
        }}
      />
      <div className="max-w-5xl mx-auto">
        <header className="mb-12 text-center">
          <h1 className="text-3xl font-bold mb-2">Security Incident Report</h1>
          <p className="text-muted-foreground">Please fill out the form below to report an incident</p>
        </header>
        
        <main>
          <IncidentReportForm />
        </main>
        
        <footer className="mt-16 text-center text-sm text-muted-foreground">
          <p>🪁 Powered by CopilotKit</p>
        </footer>
      </div>
    </div>
  );
}
