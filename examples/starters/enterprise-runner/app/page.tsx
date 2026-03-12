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

// Disable static optimization for this page
export const dynamic = "force-dynamic";

export default function Home() {
  // Define a wildcard renderer for any undefined tools
  const wildcardRenderer = defineToolCallRenderer({
    name: "*",
    // No args needed for wildcard - defaults to z.any()
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

  const runtimeUrl = process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL || "/api/copilotkit";

  return (
    <CopilotKitProvider
      runtimeUrl={runtimeUrl}
      renderToolCalls={[wildcardRenderer]}
      showDevConsole="auto"
      renderActivityMessages={[
        {
          activityType: "a2ui-surface",
          content: z.any(),
          render: ({ content }) => {
            return <pre>{JSON.stringify(content, null, 2)}</pre>;
          },
        },
      ]}
    >
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
        <Chat />
      </div>
    </CopilotKitProvider>
  );
}

function Chat() {
  //useConfigureSuggestions({
  //  instructions: "Suggest helpful next actions",
  //});

  // useConfigureSuggestions({
  //   suggestions: [
  //     {
  //       title: "Action 1",
  //       message: "Do action 1",
  //     },
  //     {
  //       title: "Action 2",
  //       message: "Do action 2",
  //     },
  //   ],
  // });

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