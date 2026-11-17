export type Tone = "professional" | "casual" | "enthusiastic";
export type Expertise = "beginner" | "intermediate" | "expert";
export type ResponseLength = "concise" | "detailed";

// A type alias, not an interface, so it fits the provider's `properties`
// prop (`Record<string, unknown>`).
export type AgentConfig = {
  tone: Tone;
  expertise: Expertise;
  responseLength: ResponseLength;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  tone: "professional",
  expertise: "intermediate",
  responseLength: "concise",
};

export const TONE_OPTIONS: readonly Tone[] = [
  "professional",
  "casual",
  "enthusiastic",
];
export const EXPERTISE_OPTIONS: readonly Expertise[] = [
  "beginner",
  "intermediate",
  "expert",
];
export const RESPONSE_LENGTH_OPTIONS: readonly ResponseLength[] = [
  "concise",
  "detailed",
];
