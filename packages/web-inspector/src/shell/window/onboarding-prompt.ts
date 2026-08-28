/**
 * The Intelligence install prompt the Inspector hands to a coding agent.
 *
 * Every other Intelligence call to action in the Inspector opens a page in a
 * new tab, which is where developers drop out: they leave the editor, meet a
 * signup form, and never come back. This prompt lets the install happen where
 * they already are.
 *
 * The wording is kept byte-identical to `INTELLIGENCE_ONBOARDING_PROMPT` in the
 * Intelligence app (`apps/app-frontend/react-shell/src/home/intelligence-home.tsx`).
 * The CLI resolves `onboard start` against a prompt graph, so the two surfaces
 * must not drift — if the CLI's entry point changes, both change together.
 */
const RUN_ID_PLACEHOLDER = "<run-id>";

export const ONBOARDING_PROMPT_TEMPLATE =
  "Identify which coding-agent product you are, using a short slug such as " +
  "`codex` or `claude-code`. From the root of the project where you want " +
  "CopilotKit, run `npx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER}` +
  " --coding-agent <coding-agent-slug>`. Follow the Markdown instructions it " +
  "prints until onboarding is complete.";

/** Length and alphabet are the CLI's, so a run id copied here resolves there. */
const RUN_ID_LENGTH = 12;

/**
 * Mint the identifier that joins this copy to the CLI run it starts.
 *
 * The Intelligence app derives it from `crypto.randomUUID()`. The Inspector
 * runs inside whatever page embeds it, so neither `randomUUID` nor a secure
 * context is guaranteed; the two fallbacks keep the id present rather than
 * letting the button fail. Collision risk is irrelevant — this correlates
 * telemetry, it does not authorise anything.
 */
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

/** Bind one run id into the prompt text that gets copied. */
export function createOnboardingPrompt(runId: string): string {
  return ONBOARDING_PROMPT_TEMPLATE.replace(RUN_ID_PLACEHOLDER, runId);
}
