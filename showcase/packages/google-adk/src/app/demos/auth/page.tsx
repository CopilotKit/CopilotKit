"use client";

import React, { useMemo, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core/v2";

import { AuthBanner } from "./auth-banner";
import { DEMO_TOKEN } from "./demo-token";

export default function AuthDemo() {
  const [token, setToken] = useState<string | null>(null);

  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-auth"
      agent="auth-demo"
      headers={headers as Record<string, string>}
    >
      <div className="min-h-screen w-full bg-gray-50 flex flex-col">
        <AuthBanner
          authenticated={Boolean(token)}
          onSignIn={() => setToken(DEMO_TOKEN)}
          onSignOut={() => setToken(null)}
        />
        <main className="flex-1 flex justify-center items-center p-6">
          <div className="h-full w-full max-w-4xl">
            <CopilotChat
              agentId="auth-demo"
              className="h-full rounded-2xl bg-white border border-gray-200 shadow-sm"
              labels={{
                chatInputPlaceholder: token
                  ? "Authenticated — chat away..."
                  : "Sign in to enable chat.",
              }}
            />
          </div>
        </main>
      </div>
    </CopilotKit>
  );
}
