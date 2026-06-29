"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CopilotKit } from "@copilotkit/react-core/v2";
import {
  createOpenBoxCustomMessageRenderer,
  OpenBoxGovernanceDecision,
} from "@openbox-ai/openbox-sdk/copilotkit/react";
import { OpenBoxBusinessActionResult } from "@/components/openbox-business-result";
import { ThemeProvider } from "@/hooks/use-theme";
import { withBasePath } from "@/lib/base-path";
import { openBoxDemoScenarios } from "@/lib/openbox-demo-scenarios";

const openBoxTheme = {
  logoSrc: withBasePath("/openbox-mark.png"),
  accentColor: "#3B9AF5",
  radius: 8,
  density: "comfortable" as const,
  mode: "auto" as const,
};

const openBoxCustomMessageRenderers = [
  createOpenBoxCustomMessageRenderer({
    theme: openBoxTheme,
    scenarios: openBoxDemoScenarios as any,
    renderGovernanceDecision: (props) => (
      <OpenBoxGovernanceDecision
        {...(props as any)}
        theme={openBoxTheme}
        scenarios={openBoxDemoScenarios as any}
      />
    ),
    renderActionResult: ({ result }) => (
      <OpenBoxBusinessActionResult result={result} />
    ),
  }),
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>OpenBox × CopilotKit — Governed Assistant</title>
        <meta
          name="description"
          content="A CopilotKit + LangGraph agent with OpenBox runtime governance — guardrails, policies, and human-in-the-loop approvals."
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href={withBasePath("/copilotkit-logo-mark.svg")}
        />
      </head>
      <body className={`antialiased`}>
        <ThemeProvider>
          <Suspense fallback={null}>
            <CopilotProviderWithReset>{children}</CopilotProviderWithReset>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}

function CopilotProviderWithReset({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [copilotSessionKey, setCopilotSessionKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const resetKey = searchParams.get("reset");
    setCopilotSessionKey(
      (current) => resetKey ?? current ?? `session-${Date.now()}`,
    );
  }, [searchParams]);

  return (
    <>
      {copilotSessionKey ? (
        <CopilotKit
          key={copilotSessionKey}
          runtimeUrl={withBasePath("/api/copilotkit")}
          inspectorDefaultAnchor={{ horizontal: "right", vertical: "top" }}
          renderCustomMessages={openBoxCustomMessageRenderers}
          useSingleEndpoint={false}
        >
          {children}
        </CopilotKit>
      ) : null}
    </>
  );
}
