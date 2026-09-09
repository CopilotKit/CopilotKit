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

/**
 * The feature outcomes a docs guide asks the CLI prompt graph for.
 *
 * A subset of `ONBOARDING_INTENT_ROOTS` in Intelligence's
 * `apps/cli/onboarding-intents.cjs`, which is the source of truth for the
 * full set of seven. Only the guides that ship a prompt card appear here; the
 * rest of the docs keep the generic prompt above, because a reader who has no
 * CopilotKit app yet cannot be served by a route that requires one.
 */
export type FeatureOnboardingIntent = "add-learning" | "add-rich-threads";

/**
 * The prompt a feature guide's card copies.
 *
 * It carries no setup instruction of its own, and it must not gain any. The
 * `--intent` route owns the guide links, the plan, the per-phase check-ins,
 * the refusal when a prerequisite is missing, and the proof step. Prose
 * repeated here would drift from the route the next time the underlying API
 * changes, which is what happened to the hand-written Learning prompt this
 * function replaced.
 *
 * No `--run` id: these strings are static, and `llm-text` inlines them into
 * cached raw Markdown, so one id minted here would be shared by every reader.
 * The CLI mints its own when the flag is absent.
 */
export function createFeatureSetupPrompt(
  intent: FeatureOnboardingIntent,
): string {
  return (
    "Identify your coding-agent slug (for example, `codex` or " +
    "`claude-code`). From the root of this repository, run `npx --yes " +
    `copilotkit@latest onboard start --coding-agent <coding-agent-slug> --intent ${intent}` +
    "`. Follow the Markdown instructions it prints until setup is complete. " +
    "If it requires a CopilotKit CLI session check, you have permission to " +
    "run it; never reveal credentials or send optional diagnostic feedback " +
    "reports."
  );
}
