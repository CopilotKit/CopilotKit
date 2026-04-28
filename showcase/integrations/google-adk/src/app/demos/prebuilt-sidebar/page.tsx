"use client";

import React from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function PrebuiltSidebarDemo() {
  return (
    // @region[sidebar-basic-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt_sidebar">
      <DemoContent />
    </CopilotKit>
    // @endregion[sidebar-basic-setup]
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Help me focus",
        message: "Suggest 3 ways to focus on my work today.",
      },
      {
        title: "Daily standup",
        message: "Help me draft a 3-bullet daily standup update.",
      },
    ],
    available: "always",
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <main className="max-w-3xl mx-auto px-6 py-16 prose prose-slate">
        <h1>Pre-Built Sidebar</h1>
        <p>
          The CopilotSidebar component docks chat to the right edge of the page
          and stays mounted across navigations. Open it via the bottom-right
          launcher.
        </p>
        <p>
          The agent on the backend is a plain Gemini 2.5 Flash LlmAgent — no
          tools, no state. All the polish is on the frontend.
        </p>
      </main>
      {/* @region[sidebar-configuration] */}
      <CopilotSidebar
        defaultOpen={true}
        labels={{ modalHeaderTitle: "AI Assistant" }}
      />
      {/* @endregion[sidebar-configuration] */}
    </div>
  );
}
