"use client";

import React from "react";
import { useFramework } from "./framework-provider";

export function IntegrationGrid({ path }: { path?: string; exclude?: string[] }) {
  const { framework } = useFramework();

  // On a framework-scoped route the user already chose a backend — hide.
  if (framework) return null;

  return (
    <>
      <h2>Choose your AI backend</h2>
      <div
        style={{
          padding: "1rem",
          background: "var(--bg-elevated)",
          borderRadius: "0.5rem",
          marginBottom: "1rem",
          fontSize: "0.875rem",
          color: "var(--text-muted)",
        }}
      >
        See{" "}
        <a href="/integrations" style={{ color: "var(--accent)" }}>
          Integrations
        </a>{" "}
        for all available frameworks{path ? ` (${path})` : ""}.
      </div>
    </>
  );
}
