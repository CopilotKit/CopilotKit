"use client";

import React from "react";

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
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "#ccc",
              marginBottom: "8px",
            }}
          >
            {this.props.demoName} — Demo Error
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
