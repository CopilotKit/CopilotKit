// frontend/src/components/chat/CopilotChatInterface.tsx
"use client";

import "@copilotkit/react-core/v2/styles.css";
import { useEffect, useMemo, useState } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotThreadsDrawer,
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

import styles from "./CopilotKit.module.css";

const COPILOTKIT_AGENT_ID = "default";
type ResolvedAwsExportsConfig = AwsExportsConfig & {
  copilotKitRuntimeUrl: string;
};

function CopilotChatContent() {
  const [mode, setMode] = useState<"chat" | "app">("chat");

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
    /*
      One UNCONTROLLED CopilotChatConfigurationProvider (no `threadId` prop) owns
      the active thread for the whole surface. The SDK <CopilotThreadsDrawer> drives it
      directly — picking a row sets the active thread, "+ New" resets to a fresh
      thread — with no host thread-state. The drawer inherits `runtimeUrl` and
      the Cognito auth `headers` from the surrounding <CopilotKitProvider> (via
      useThreads -> useCopilotKit), so threads are fetched authenticated with no
      explicit props. A *controlled* provider would block "+ New" from
      resetting, so uncontrolled-inside-provider is required, not optional.
    */
    <CopilotChatConfigurationProvider agentId={COPILOTKIT_AGENT_ID}>
      <div className={styles.layout}>
        {/* SDK threads drawer (replaces the hand-rolled fork). License-gated: the locked view's Upgrade CTA opens the Intelligence docs by default. */}
        <CopilotThreadsDrawer agentId={COPILOTKIT_AGENT_ID} />
        <div className={styles.mainPanel}>
          <div className="h-full flex flex-row">
            <ModeToggle mode={mode} onModeChange={setMode} />
            <div
              className={`max-h-full overflow-y-auto [&_.copilotKitChat]:h-full [&_.copilotKitChat]:border-0 [&_.copilotKitChat]:shadow-none ${
                mode === "app"
                  ? "w-1/2 px-6 max-lg:hidden"
                  : "flex-1 px-4 lg:px-6"
              }`}
            >
              <CopilotChat agentId={COPILOTKIT_AGENT_ID} className="h-full" />
            </div>
            <div
              className={`h-full overflow-hidden ${
                mode === "app"
                  ? "w-1/2 border-l dark:border-zinc-700 max-lg:w-full max-lg:border-l-0"
                  : "w-0 border-l-0"
              }`}
            >
              {/*
                Fill the state panel's own width. The previous `lg:w-[66.666vw]`
                was viewport-relative, so with a reserved drawer column it
                overflowed this container (clipped by overflow-hidden) and
                pushed centered content right of the visible box's center.
              */}
              <div className="h-full w-full">
                <TodoCanvas />
              </div>
            </div>
          </div>
        </div>
      </div>
    </CopilotChatConfigurationProvider>
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
      <CopilotChatContent />
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
