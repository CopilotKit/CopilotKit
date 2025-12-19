"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  useFrontendTool,
  defineToolCallRenderer,
  useConfigureSuggestions,
} from "@copilotkitnext/react";
import type { ToolsMenuItem } from "@copilotkitnext/react";
import { z } from "zod";
import { useMemo } from "react";

export const dynamic = "force-dynamic";

export default function SingleEndpointDemo() {
  const wildcardRenderer = defineToolCallRenderer({
    name: "*",
    render: ({ name, args, status }) => (
      <div
        style={{
          padding: "12px",
          margin: "8px 0",
          backgroundColor: "#f0f0f0",
          borderRadius: "8px",
          border: "1px solid #ccc",
        }}
      >
        <strong>Unknown Tool: {name}</strong>
        <pre style={{ marginTop: "8px", fontSize: "12px" }}>
          Status: {status}
          {args && "\nArguments: " + JSON.stringify(args, null, 2)}
        </pre>
      </div>
    ),
  });

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-single"
      useSingleEndpoint
      renderToolCalls={[wildcardRenderer]}
      showDevConsole="auto"
    >
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
        <Chat />
      </div>
    </CopilotKitProvider>
  );
}

function Chat() {
  useFrontendTool({
    name: "sayHello",
    parameters: z.object({
      name: z.string(),
    }),
    handler: async ({ name }) => {
      alert(`Hello ${name}`);
      return `Hello ${name}`;
    },
  });

  useConfigureSuggestions({
    instructions: "Suggest follow-up tasks based on the current page content",
  });

  const toolsMenu = useMemo<(ToolsMenuItem | "-")[]>(
    () => [
      {
        label: "Say hi to CopilotKit",
        action: () => {
          const textarea = document.querySelector<HTMLTextAreaElement>("textarea[placeholder='Type a message...']");
          if (!textarea) {
            return;
          }

          const greeting = "Hello Copilot! 👋 Could you help me with something?";

          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          )?.set;
          nativeInputValueSetter?.call(textarea, greeting);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.focus();
        },
      },
      "-",
      {
        label: "Open CopilotKit Docs",
        action: () => {
          window.open("https://docs.copilotkit.ai", "_blank", "noopener,noreferrer");
        },
      },
    ],
    [],
  );

  return <CopilotChat inputProps={{ toolsMenu }} threadId="xyz" />;
}
