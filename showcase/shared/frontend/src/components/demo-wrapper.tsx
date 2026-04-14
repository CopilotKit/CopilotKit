import React, { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";

// ---------- Error Boundary ----------

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class DemoErrorBoundary extends React.Component<
  { children: React.ReactNode; demoName: string },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; demoName: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[DemoErrorBoundary] ${this.props.demoName} crashed:`,
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            color: "#888",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>
            {"\u26A0\uFE0F"}
          </div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "#ccc",
              marginBottom: "8px",
            }}
          >
            {this.props.demoName} &mdash; Demo Error
          </h2>
          <p
            style={{
              fontSize: "14px",
              maxWidth: "400px",
              lineHeight: 1.5,
            }}
          >
            The demo encountered an error. This usually means the agent backend
            isn&apos;t responding. Check the server logs.
          </p>
          <pre
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              background: "#1a1a2e",
              borderRadius: "8px",
              fontSize: "12px",
              color: "#f87171",
              maxWidth: "500px",
              overflow: "auto",
              textAlign: "left",
            }}
          >
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "16px",
              padding: "8px 20px",
              background: "#333",
              border: "1px solid #555",
              borderRadius: "8px",
              color: "#ccc",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ---------- Demo Wrapper ----------

interface DemoWrapperProps {
  demoName: string;
  agentId: string;
  children: React.ReactNode;
}

export function DemoWrapper({ demoName, agentId, children }: DemoWrapperProps) {
  useEffect(() => {
    console.log(`[${agentId}] Demo mounted: ${demoName}`);
    console.log(`[${agentId}] Runtime URL: /api/copilotkit`);
    console.log(`[${agentId}] Agent ID: ${agentId}`);
    console.log(`[${agentId}] Timestamp: ${new Date().toISOString()}`);

    return () => {
      console.log(`[${agentId}] Demo unmounted: ${demoName}`);
    };
  }, [demoName, agentId]);

  return (
    <DemoErrorBoundary demoName={demoName}>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent={agentId}
        onError={(error) => {
          console.error(`[${agentId}] CopilotKit error:`, error);
        }}
      >
        {children}
      </CopilotKit>
    </DemoErrorBoundary>
  );
}
