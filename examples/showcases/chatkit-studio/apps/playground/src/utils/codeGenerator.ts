/**
 * Code Generator Utilities
 *
 * Generates exportable code files based on playground configuration.
 * Used by CodeExporter component to create ready-to-use implementations
 * of customized CopilotKit chat components.
 */

import { PlaygroundConfig } from "@/types/playground";

export interface ExportedFiles {
  component: string;
  layout: string;
  apiRoute: string;
  envVars: string;
}

export function generateExportFiles(config: PlaygroundConfig): ExportedFiles {
  // Extract individual parts from hybrid code
  const reactCode = `import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function MyChat() {
  const customStyles = \`
    .chat-container {
      height: 100% !important;
      display: flex;
      flex-direction: column;
      overflow: scroll;
      border-radius: ${config.style.borderRadius} !important;
    }

    /* Typography */
    .copilotKitMessages,
    .copilotKitInput,
    .copilotKitUserMessage,
    .copilotKitAssistantMessage,
    .copilotKitMarkdownElement {
      font-family: ${config.typography.fontFamily} !important;
      font-size: ${config.typography.fontSize} !important;
    }

    /* Border radius for message bubbles */
    .copilotKitUserMessage,
    .copilotKitAssistantMessage {
      border-radius: ${config.style.bubbleBorderRadius} !important;
    }

    /* Padding */
    .copilotKitMessages {
      padding: ${config.style.padding} !important;
    }

    .copilotKitInput {
      padding: ${config.style.padding} !important;
      background-color: ${config.colors.inputBackground} !important;
    }

    .copilotKitInput input,
    .copilotKitInput textarea,
    .copilotKitInput [contenteditable] {
      background-color: ${config.colors.inputBackground} !important;
      color: ${config.colors.secondaryContrast} !important;
    }

    .copilotKitChat {
      height: 100% !important;
    }
  \`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: customStyles }} />
      <div
        className="chat-container"
        style={{
          "--copilot-kit-primary-color": "${config.colors.primary}",
          "--copilot-kit-contrast-color": "${config.colors.contrast}",
          "--copilot-kit-background-color": "${config.colors.background}",
          "--copilot-kit-secondary-color": "${config.colors.secondary}",
          "--copilot-kit-secondary-contrast-color": "${config.colors.secondaryContrast}",
          "--copilot-kit-separator-color": "${config.colors.separator}",
          "--copilot-kit-muted-color": "${config.colors.muted}",
        } as CopilotKitCSSProperties}
      >
        <CopilotChat
          labels={{
            title: "${config.labels.title}",
            initial: "${config.labels.initial}",
            placeholder: "${config.labels.placeholder}",
          }}
        />
      </div>
    </>
  );
}`;

  const apiRouteCode = `import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { NextRequest } from "next/server";

const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
  agents: {
    [process.env.LANGGRAPH_GRAPH_ID || "${config.agentConfig.agentName}"]: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL || "${config.agentConfig.agUiUrl}",
      graphId: process.env.LANGGRAPH_GRAPH_ID || "${config.agentConfig.agentName}",
      langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
    }),
  }
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};`;

  const layoutCode = `import { CopilotKit } from "@copilotkit/react-core";
  import "./globals.css";
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit" agent="${config.agentConfig.agentName}">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}`;

  const envFileCode = `LANGGRAPH_DEPLOYMENT_URL=${config.agentConfig.agUiUrl}
LANGGRAPH_GRAPH_ID=${config.agentConfig.agentName}
LANGSMITH_API_KEY=`;

  return {
    component: reactCode,
    layout: layoutCode,
    apiRoute: apiRouteCode,
    envVars: envFileCode,
  };
}
