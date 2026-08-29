const RUN_ID_PLACEHOLDER = "<run-id>";

export const INTELLIGENCE_ONBOARDING_EVENTS = {
  promptCopied: "docs.intelligence_onboarding_prompt_copied",
} as const;

/**
 * The coding-agent prompt used by Intelligence, Inspector, and Shell Docs.
 *
 * Keep this byte-identical to `INTELLIGENCE_ONBOARDING_PROMPT` in
 * Intelligence's `intelligence-home.tsx` and `ONBOARDING_PROMPT_TEMPLATE` in
 * the Inspector. The CLI prompt graph decides the correct path after it
 * inspects the repository; the docs CTA only changes the feature promise.
 */
export const INTELLIGENCE_ONBOARDING_PROMPT =
  "Identify which coding-agent product you are, using a short slug such as " +
  "`codex` or `claude-code`. From the root of the project where you want " +
  "CopilotKit, run `npx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER}` +
  " --coding-agent <coding-agent-slug>`. Follow the Markdown instructions it " +
  "prints until onboarding is complete.";

const RUN_ID_LENGTH = 12;

/** Mint the telemetry identifier shared by the docs CTA and CLI run. */
export function createOnboardingRunId(): string {
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

/** Bind one run id into the canonical prompt. */
export function createIntelligenceOnboardingPrompt(runId: string): string {
  return INTELLIGENCE_ONBOARDING_PROMPT.replace(RUN_ID_PLACEHOLDER, runId);
}
