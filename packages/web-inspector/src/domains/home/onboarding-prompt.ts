import type { HomeServiceId } from "./model.js";

/**
 * The Intelligence install prompt the Inspector hands to a coding agent.
 *
 * The wording is kept byte-identical to `INTELLIGENCE_ONBOARDING_PROMPT` in the
 * Intelligence app. The CLI resolves `onboard start` against a prompt graph,
 * so the two surfaces must not drift.
 */
const RUN_ID_PLACEHOLDER = "<run-id>";

export const ONBOARDING_PROMPT_TEMPLATE =
  "Help me get started with CopilotKit. Run this command and follow the " +
  "instructions:\n\nnpx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER}`;

const RUN_ID_LENGTH = 12;

export function createOnboardingRunId() {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID().replaceAll("-", "").slice(0, RUN_ID_LENGTH);
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(RUN_ID_LENGTH / 2));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  let id = "";
  while (id.length < RUN_ID_LENGTH) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id.slice(0, RUN_ID_LENGTH);
}

export function createOnboardingPrompt(runId: string) {
  return ONBOARDING_PROMPT_TEMPLATE.replace(RUN_ID_PLACEHOLDER, runId);
}

export const ONBOARDING_INTENTS = [
  "add-a2ui",
  "add-chat-suggestions",
  "add-learning",
  "add-open-generative-ui",
  "add-realtime-sync",
  "add-rich-threads",
  "add-voice",
] as const;

export type OnboardingIntent = (typeof ONBOARDING_INTENTS)[number];

export const FEATURE_ONBOARDING_INTENT: Record<
  HomeServiceId,
  OnboardingIntent
> = {
  threads: "add-rich-threads",
  memory: "add-learning",
  a2ui: "add-a2ui",
  "open-gen-ui": "add-open-generative-ui",
  suggestions: "add-chat-suggestions",
  audio: "add-voice",
  websocket: "add-realtime-sync",
};

const INTENT_PLACEHOLDER = "<intent>";

export const FEATURE_ONBOARDING_PROMPT_TEMPLATE =
  "Help me set this up in my CopilotKit app. Run this command and follow the " +
  "instructions:\n\nnpx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER} --intent ${INTENT_PLACEHOLDER}` +
  "\n\nIf it requires a CopilotKit CLI session check, you have permission to " +
  "run it. Never reveal credentials.";

export function createFeatureOnboardingPrompt(
  serviceId: HomeServiceId,
  runId: string,
) {
  return FEATURE_ONBOARDING_PROMPT_TEMPLATE.replace(
    RUN_ID_PLACEHOLDER,
    runId,
  ).replace(INTENT_PLACEHOLDER, FEATURE_ONBOARDING_INTENT[serviceId]);
}
