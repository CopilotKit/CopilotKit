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
  });

  return (
    <div className="min-h-screen p-8 pb-20 font-[family-name:var(--font-geist-sans)] sm:p-12">
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
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 text-center">
          <h1 className="mb-2 text-3xl font-bold">Security Incident Report</h1>
          <p className="text-muted-foreground">
            Please fill out the form below to report an incident
          </p>
        </header>

        <main>
          <IncidentReportForm />
        </main>

        <footer className="text-muted-foreground mt-16 text-center text-sm">
          <p>🪁 Powered by CopilotKit</p>
        </footer>
      </div>
    </div>
  );
}
