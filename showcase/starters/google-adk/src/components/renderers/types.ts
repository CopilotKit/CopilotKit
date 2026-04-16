export const RENDER_MODES = [
  "tool-based",
  "a2ui",
  "json-render",
  "hashbrown",
] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export interface RenderStrategyInfo {
  mode: RenderMode;
  name: string;
  description: string;
  icon: string;
  features: {
    streaming: boolean;
    interactivity: boolean;
    sandbox: boolean;
    constraintLevel: "high" | "medium" | "low" | "none";
  };
}

export const RENDER_STRATEGIES: RenderStrategyInfo[] = [
  {
    mode: "tool-based",
    name: "Tool-Based",
    description: "Agent calls typed tool functions",
    icon: "\u{1F527}",
    features: {
      streaming: false,
      interactivity: true,
      sandbox: false,
      constraintLevel: "high",
    },
  },
  {
    mode: "a2ui",
    name: "A2UI Catalog",
    description: "Component tree from predefined catalog",
    icon: "\u{1F4CB}",
    features: {
      streaming: false,
      interactivity: true,
      sandbox: false,
      constraintLevel: "medium",
    },
  },
  {
    mode: "json-render",
    name: "json-render",
    description: "JSONL patches with built-in state",
    icon: "\u{1F4C4}",
    features: {
      streaming: true,
      interactivity: true,
      sandbox: false,
      constraintLevel: "medium",
    },
  },
  {
    mode: "hashbrown",
    name: "HashBrown",
    description: "Streaming structured output",
    icon: "\u{1F954}",
    features: {
      streaming: true,
      interactivity: false,
      sandbox: false,
      constraintLevel: "high",
    },
  },
];
