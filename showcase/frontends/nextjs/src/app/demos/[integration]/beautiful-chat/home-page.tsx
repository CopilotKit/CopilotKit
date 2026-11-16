"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { ExampleLayout } from "./components/example-layout";
import { ExampleCanvas } from "./components/example-canvas";
import { useExampleSuggestions } from "./hooks/use-example-suggestions";
import { useGenerativeUIExamples } from "./hooks/use-generative-ui-examples";

export function HomePage() {
  useGenerativeUIExamples();
  useExampleSuggestions();

  return (
    <ExampleLayout
      chatContent={
        <CopilotChat
          attachments={{ enabled: true }}
          input={{ disclaimer: () => null, className: "pb-6" }}
        />
      }
      appContent={<ExampleCanvas />}
    />
  );
}
