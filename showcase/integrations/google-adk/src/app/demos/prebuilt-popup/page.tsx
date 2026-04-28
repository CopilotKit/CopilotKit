"use client";

import React from "react";
import {
  CopilotKit,
  CopilotPopup,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function PrebuiltPopupDemo() {
  return (
    // @region[popup-basic-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="prebuilt_popup">
      <DemoContent />
    </CopilotKit>
    // @endregion[popup-basic-setup]
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Quick recipe", message: "Suggest a 15-minute pasta recipe." },
      {
        title: "Travel tip",
        message: "Give me one weekend-trip idea near Tokyo.",
      },
    ],
    available: "always",
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-cyan-50">
      <main className="max-w-3xl mx-auto px-6 py-16 prose prose-slate">
        <h1>Pre-Built Popup</h1>
        <p>
          The CopilotPopup component renders a floating chat bubble. Click it to
          expand into a windowed chat surface that overlays the page.
        </p>
      </main>
      <CopilotPopup defaultOpen={false} />
    </div>
  );
}
