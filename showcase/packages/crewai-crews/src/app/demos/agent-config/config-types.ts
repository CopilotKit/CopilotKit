export type Tone = "professional" | "casual" | "enthusiastic";
export type Expertise = "beginner" | "intermediate" | "expert";
export type ResponseLength = "concise" | "detailed";

export interface AgentConfig {
  tone: Tone;
  expertise: Expertise;
  responseLength: ResponseLength;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  tone: "professional",
  expertise: "intermediate",
  responseLength: "concise",
};

export const TONE_OPTIONS: Tone[] = ["professional", "casual", "enthusiastic"];
export const EXPERTISE_OPTIONS: Expertise[] = [
  "beginner",
  "intermediate",
  "expert",
];
export const RESPONSE_LENGTH_OPTIONS: ResponseLength[] = [
  "concise",
  "detailed",
];
