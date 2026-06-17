// frontend/src/components/chat/CopilotChatInterface.tsx
"use client";

import "@copilotkit/react-core/v2/styles.css";
import { useEffect, useMemo, useState } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { useAuth as useOidcAuth } from "react-oidc-context";
import { loadAwsConfig } from "@/lib/runtime-config";
import type { AwsExportsConfig } from "@/lib/runtime-config";
import { useExampleSuggestions } from "@/hooks/useExampleSuggestions";
import { useCopilotExamples } from "@/hooks/useCopilotExamples";
import { ThemeProvider } from "@/hooks/useTheme";
import { TodoCanvas } from "@/components/canvas/TodoCanvas";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { ThreadsDrawer } from "@/components/threads-drawer";
import { ThreadsPanelGate } from "@/components/threads-drawer/locked-state";

import styles from "@/components/threads-drawer/threads-drawer.module.css";

const COPILOTKIT_AGENT_ID = "default";
type ResolvedAwsExportsConfig = AwsExportsConfig & {
  copilotKitRuntimeUrl: string;
};

function CopilotChatContent({
  runtimeUrl,
  headers,
}: {
  runtimeUrl: string;
  headers: Record<string, string> | undefined;
}) {
  const [mode, setMode] = useState<"chat" | "app">("chat");
  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  useExampleSuggestions();
  useCopilotExamples();

  useFrontendTool({
    name: "enableAppMode",
    description: "Enable app mode when working with the todo canvas.",
    handler: async () => {
      setMode("app");
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
    <div className={styles.layout}>
      <ThreadsPanelGate>
        <ThreadsDrawer
          agentId={COPILOTKIT_AGENT_ID}
          threadId={threadId}
          onThreadChange={setThreadId}
          runtimeUrl={runtimeUrl}
          headers={headers}
        />
      </ThreadsPanelGate>
      <div className={styles.mainPanel}>
        <CopilotChatConfigurationProvider
          agentId={COPILOTKIT_AGENT_ID}
          threadId={threadId}
        >
          <div className="h-full flex flex-row">
            <ModeToggle mode={mode} onModeChange={setMode} />
            <div
              className={`max-h-full overflow-y-auto [&_.copilotKitChat]:h-full [&_.copilotKitChat]:border-0 [&_.copilotKitChat]:shadow-none ${
                mode === "app"
                  ? "w-1/3 px-6 max-lg:hidden"
                  : "flex-1 px-4 lg:px-6"
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
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

function CopilotKitShell({
  config,
  accessToken,
}: {
  config: ResolvedAwsExportsConfig;
  accessToken: string | undefined;
}) {
  const headers = useMemo(
    () =>
      accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    [accessToken],
  );

  return (
    <CopilotKitProvider
      runtimeUrl={config.copilotKitRuntimeUrl}
      headers={headers}
      useSingleEndpoint={false}
    >
      <CopilotChatContent
        runtimeUrl={config.copilotKitRuntimeUrl}
        headers={headers}
      />
    </CopilotKitProvider>
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
        <CopilotKitShell
          config={config as ResolvedAwsExportsConfig}
          accessToken={accessToken}
        />
      </div>
    </ThemeProvider>
  );
}
