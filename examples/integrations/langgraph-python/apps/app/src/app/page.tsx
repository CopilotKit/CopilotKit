"use client";

import { ExampleLayout } from "@/components/example-layout";
import { ExampleCanvas } from "@/components/example-canvas";
import { useGenerativeUIExamples, useExampleSuggestions } from "@/hooks";

import { CopilotChat } from "@copilotkit/react-core/v2";
// import { HeadlessChat } from "@/components/headless-chat";

export default function HomePage() {
  // 🪁 Generative UI Examples
  useGenerativeUIExamples();

  // 🪁 Example Suggestions
  useExampleSuggestions();

  return (
    <ExampleLayout
      chatContent={<CopilotChat />}
      // chatContent={<HeadlessChat />}
      appContent={<ExampleCanvas />}
    />
  );
}
