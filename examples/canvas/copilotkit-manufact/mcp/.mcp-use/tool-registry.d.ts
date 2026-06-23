// Auto-generated tool registry types - DO NOT EDIT MANUALLY
// This file is regenerated whenever tools are added, removed, or updated during development
// Generated at: 2026-05-08T15:04:38.346Z

declare module "mcp-use/react" {
  interface ToolRegistry {
    "show-lead-demand": {
      input: { "leads": Array<{ "id": string; "name": string; "email": string; "company": string; "role": string; "workshop": string; "technical_level": string; "tools": Array<string>; "status": string; "opt_in": boolean }> };
      output: Record<string, unknown>;
    };
    "show-lead-list": {
      input: { "leads": Array<{ "id": string; "name": string; "email": string; "company": string; "role": string; "workshop": string; "technical_level": string; "tools": Array<string>; "status": string; "opt_in": boolean }>; "segments": Array<{ "id": string; "name": string; "color"?: "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet" | "slate" | undefined; "leadIds": Array<string> }> };
      output: Record<string, unknown>;
    };
    "show-lead-pipeline": {
      input: { "leads": Array<{ "id": string; "name": string; "email": string; "company": string; "role": string; "workshop": string; "technical_level": string; "tools": Array<string>; "status": string; "opt_in": boolean }>; "segments": Array<{ "id": string; "name": string; "color"?: "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet" | "slate" | undefined; "leadIds": Array<string> }> };
      output: Record<string, unknown>;
    };
  }
}

export {};
