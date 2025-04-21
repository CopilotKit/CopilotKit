import { type ComponentType } from "react";

export type LLMProvider = "openai" | "anthropic";

export interface DemoFile {
  name: string; // Display name (filename only)
  path: string; // Full file path
  content: string;
  language: string;
}

export interface DemoConfig {
  id: string;
  name: string;
  description: string;
  path: string; // Path to the agent source directory (e.g., agent/demo/crewai_agentic_chat)
  files: DemoFile[];
  // Function to dynamically import the demo's main UI component (page.tsx)
  component?: () => Promise<ComponentType>;
  iframeUrl?: string;
  sourceCodeUrl?: string;
  defaultLLMProvider?: LLMProvider;
  tags?: string[];
}

export interface BrandConfig {
  id: string;
  name: string;
  logo: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface ViewerConfig {
  showCodeEditor?: boolean;
  showFileTree?: boolean;
  showLLMSelector?: boolean;
}
