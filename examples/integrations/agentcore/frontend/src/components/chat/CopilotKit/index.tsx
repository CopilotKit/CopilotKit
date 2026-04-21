// frontend/src/components/chat/CopilotChatInterface.tsx
"use client";

import "@copilotkit/react-core/v2/styles.css";
import { useEffect, useState } from "react";
import {
  CopilotChat,
  CopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { useAuth as useOidcAuth } from "react-oidc-context";
import { loadAwsConfig, type AwsExportsConfig } from "@/lib/runtime-config";
import { useExampleSuggestions } from "@/hooks/useExampleSuggestions";
import { useCopilotExamples } from "@/hooks/useCopilotExamples";
import { ThemeProvider } from "@/hooks/useTheme";
import { TodoCanvas } from "@/components/canvas/TodoCanvas";
import { ModeToggle } from "@/components/ui/mode-toggle";

const COPILOTKIT_AGENT_ID = "default";

function CopilotChatContent() {
  const [mode, setMode] = useState<"chat" | "app">("chat");

  useExampleSuggestions();
  useCopilotExamples();

  useFrontendTool({
    name: "enableAppMode",
    description:
      "Enable app mode when working with the todo canvas. Returns an app_mode_token that MUST be passed to manage_todos. Call this ALONE first, wait for the returned token, then call manage_todos.",
    handler: async () => {
      setMode("app");
      return "APP_MODE_READY";
    },
  });

  useFrontendTool({
    name: "enableChatMode",
    description: "Enable chat mode",
    handler: async () => {
      setMode("chat");
    },
  });

  return (
    <div className="h-full flex flex-row">
      <ModeToggle mode={mode} onModeChange={setMode} />
      <div
        className={`max-h-full overflow-y-auto [&_.copilotKitChat]:h-full [&_.copilotKitChat]:border-0 [&_.copilotKitChat]:shadow-none ${
          mode === "app" ? "w-1/3 px-6 max-lg:hidden" : "flex-1 px-4 lg:px-6"
        }`}
      >
        <CopilotChat agentId={COPILOTKIT_AGENT_ID} className="h-full" />
      </div>
      <div
        className={`h-full overflow-hidden ${
          mode === "app"
            ? "w-2/3 border-l dark:border-zinc-700 max-lg:w-full max-lg:border-l-0"
            : "w-0 border-l-0"
        }`}
      >
        <div className="h-full w-full lg:w-[66.666vw]">
          <TodoCanvas />
        </div>
      </div>
    </div>
  );
}

export default function CopilotChatInterface() {
  const auth = useOidcAuth();
  const [config, setConfig] = useState<AwsExportsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function resolveConfig() {
      try {
        const runtimeConfig = await loadAwsConfig();
        if (!isMounted) return;

        if (!runtimeConfig || !runtimeConfig.copilotKitRuntimeUrl) {
          throw new Error("CopilotKit runtime URL not found in configuration");
        }

        setConfig(runtimeConfig);
      } catch (err) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(`Configuration error: ${message}`);
      }
    }

    resolveConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm">
        Loading CopilotKit configuration...
      </div>
    );
  }

  const accessToken = auth.user?.access_token ?? auth.user?.id_token;

  return (
    <ThemeProvider>
      <div className="h-full bg-[#f5f7fb]">
        <CopilotKit
          runtimeUrl={config.copilotKitRuntimeUrl}
          useSingleEndpoint={false}
          headers={
            accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
          }
        >
          <CopilotChatContent />
        </CopilotKit>
      </div>
    </ThemeProvider>
  );
}
