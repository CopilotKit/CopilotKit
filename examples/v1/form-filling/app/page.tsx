"use client";

import { CopilotPopup, useAgentContext } from "@copilotkit/react-core/v2";
import { IncidentReportForm } from "@/components/IncidentReportForm";
import { retrieveUserInfo } from "@/lib/user-info";
import type { CSSProperties } from "react";

export default function Home() {
  useAgentContext({
    description: "The current user information",
    value: retrieveUserInfo(),
  });

  return (
    <div className="min-h-screen p-8 pb-20 sm:p-12 font-[family-name:var(--font-geist-sans)]">
      <CopilotPopup
        defaultOpen
        style={
          {
            "--primary": "#000000",
            "--primary-foreground": "#ffffff",
            "--ring": "#000000",
          } as CSSProperties
        }
        labels={{
          modalHeaderTitle: "✨ Incident Report Assistant",
          welcomeMessageText:
            "I'm an AI assistant built for guiding you through filing incident reports. How can I help?",
        }}
      />
      <div className="max-w-5xl mx-auto">
        <header className="mb-12 text-center">
          <h1 className="text-3xl font-bold mb-2">Security Incident Report</h1>
          <p className="text-muted-foreground">
            Please fill out the form below to report an incident
          </p>
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
