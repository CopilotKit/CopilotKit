"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import ApiKeyInput from "@/components/ApiKeyInput";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    const key = localStorage.getItem("openai_api_key");
    setApiKey(key);
  }, []);

  return (
    <html lang="en">
      <body>
        <ApiKeyInput />
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          agent="world_agent"
          headers={{
            "x-openai-api-key": apiKey || "",
          }}
        >
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
