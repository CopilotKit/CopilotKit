const RUN_ID_PLACEHOLDER = "<run-id>";

export const ONBOARDING_PROMPT_TEMPLATE =
  "Identify which coding-agent product you are, using a short slug such as " +
  "`codex` or `claude-code`. From the root of the project where you want " +
  "CopilotKit, run `npx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER}` +
  " --coding-agent <coding-agent-slug>`. Follow the Markdown instructions it " +
  "prints until onboarding is complete.";

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
