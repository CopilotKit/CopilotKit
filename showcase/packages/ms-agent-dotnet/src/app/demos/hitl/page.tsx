"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useHumanInTheLoop,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { DemoErrorBoundary } from "../error-boundary";

export default function HitlDemo() {
  return (
    <DemoErrorBoundary demoName="Human in the Loop">
      <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent">
        <DemoContent />
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Go to the moon",
        message: "Please go to the moon.",
      },
      {
        title: "Try again",
        message: "Let's attempt the moon mission again.",
      },
    ],
    available: "always",
  });

  // The .NET Dojo uses go_to_moon as a HumanInTheLoop tool.
  // The agent will pause and wait for the user to approve/reject before proceeding.
  useHumanInTheLoop({
    name: "go_to_moon",
    description: "Go to the moon on request.",
    render: ({ respond, status }: any) => (
      <MoonCard status={status} respond={respond} />
    ),
  });

  return (
    <div className="flex justify-center items-center h-full w-full">
      <div className="h-full w-full md:w-4/5 md:h-4/5 rounded-lg px-6">
        <CopilotChat className="h-full rounded-2xl max-w-6xl mx-auto" />
      </div>
    </div>
  );
}

function MoonCard({
  status,
  respond,
}: {
  status: "inProgress" | "executing" | "complete";
  respond?: (response: string) => void;
}) {
  const [decision, setDecision] = useState<"launched" | "aborted" | null>(null);

  const handleLaunch = () => {
    setDecision("launched");
    respond?.("You have permission to go to the moon.");
  };

  const handleAbort = () => {
    setDecision("aborted");
    respond?.(
      "You do not have permission to go to the moon. The user rejected the request.",
    );
  };

  return (
    <div
      data-testid="moon-card"
      style={{
        borderRadius: "16px",
        background:
          "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        padding: "32px",
        maxWidth: "400px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.3)",
      }}
    >
      {decision === "launched" ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🌕</div>
          <h2
            style={{
              color: "white",
              fontWeight: "bold",
              fontSize: "1.5rem",
              marginBottom: "0.5rem",
            }}
          >
            Mission Launched
          </h2>
          <p style={{ color: "rgba(255,255,255,0.7)" }}>
            We made it to the moon!
          </p>
        </div>
      ) : decision === "aborted" ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✋</div>
          <h2
            style={{
              color: "white",
              fontWeight: "bold",
              fontSize: "1.5rem",
              marginBottom: "0.5rem",
            }}
          >
            Mission Aborted
          </h2>
          <p style={{ color: "rgba(255,255,255,0.7)" }}>Staying on Earth 🌍</p>
        </div>
      ) : (
        <>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🚀</div>
            <h2
              style={{
                color: "white",
                fontWeight: "bold",
                fontSize: "1.5rem",
                marginBottom: "0.5rem",
              }}
            >
              Ready for Launch?
            </h2>
            <p style={{ color: "rgba(255,255,255,0.7)" }}>
              Mission to the Moon 🌕
            </p>
          </div>
          {status === "executing" && (
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                data-testid="launch-button"
                onClick={handleLaunch}
                style={{
                  flex: 1,
                  padding: "12px 24px",
                  borderRadius: "12px",
                  background: "white",
                  color: "black",
                  fontWeight: "bold",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                🚀 Launch!
              </button>
              <button
                data-testid="abort-button"
                onClick={handleAbort}
                style={{
                  flex: 1,
                  padding: "12px 24px",
                  borderRadius: "12px",
                  background: "rgba(255,255,255,0.1)",
                  color: "white",
                  fontWeight: "bold",
                  border: "2px solid rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                ✋ Abort
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
