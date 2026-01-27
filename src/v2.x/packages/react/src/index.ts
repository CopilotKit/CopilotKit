"use client";

// Re-export AG-UI runtime and types to provide a single import surface
// This helps avoid version mismatches by letting apps import everything from '@copilotkitnext/react'
// Note: @ag-ui/client already re-exports everything from @ag-ui/core, so we only export from client
// to avoid conflicting star exports during webpack builds
export * from "@ag-ui/client";

// React components and hooks for CopilotKit2
export * from "./components";
export * from "./hooks";
export * from "./providers";
export * from "./types";
export * from "./lib/react-core";
