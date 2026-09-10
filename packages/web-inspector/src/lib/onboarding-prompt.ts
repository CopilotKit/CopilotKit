import type { HomeServiceId } from "./home-briefing.js";

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
 *
 * Two lines, and deliberately nothing else. It used to open by telling the
 * agent to identify itself and pass the slug as a flag -- two sentences of
 * instruction to a machine, in the one piece of text a human reads, decides on
 * and pastes. The graph asks for the slug itself now, with `onboard identify`,
 * which is the surface that talks to the agent for the rest of the run
 * (Intelligence OSS-1157).
 *
 * This one stays generic, and so do the docs and Intelligence web-app copies
 * of it (OSS-1150). Those three are entry points for a developer with no
 * CopilotKit app yet, and every `--intent` route requires an existing app: it
 * inspects for one first and reads `feature/stop` when it is missing. The
 * feature buttons on Home are the surface that knows which feature the
 * developer is looking at, so they are the surface that names an intent — see
 * `FEATURE_ONBOARDING_PROMPT_TEMPLATE` below.
 */
const RUN_ID_PLACEHOLDER = "<run-id>";

export const ONBOARDING_PROMPT_TEMPLATE =
  "Help me get started with CopilotKit. Run this command and follow the " +
  "instructions:\n\nnpx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER}`;

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

/**
 * The closed set of feature outcomes the CLI prompt graph can start at.
 *
 * Kept equal to `ONBOARDING_INTENT_ROOTS` in Intelligence's
 * `apps/cli/onboarding-intents.cjs`, which is the build-time source of truth.
 * The two repositories cannot import each other, so the agreement is held by
 * this list plus the CLI's own `onboarding-intents.spec.ts`. Drift is loud
 * rather than silent: `onboard start` refuses an unknown `--intent` before it
 * persists a run, so a stale slug fails on the first command instead of
 * quietly onboarding the wrong feature.
 */
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

/**
 * Which feature outcome each Home tile asks the CLI for.
 *
 * The two vocabularies stay separate on purpose. A `HomeServiceId` names a
 * tile and the pane behind it, so `websocket` and `audio` are the right words
 * for it; an intent names the work to be done, so `add-realtime-sync` and
 * `add-voice` are the right words for that. One table maps between them, and
 * `Record<HomeServiceId, OnboardingIntent>` makes a new tile or a renamed
 * slug a type error rather than a missing button.
 *
 * `memory` maps to `add-learning` because the tile is the Learning tile: it is
 * enabled by a *configured Learning container* (see `learningOn` in
 * `index.ts`), which is exactly what `feature/learning` sets up. The tile id
 * and the `memories` menu key are older names for that same pane.
 */
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

/**
 * The prompt a Home feature button copies.
 *
 * It carries no feature-specific instruction, and it must not gain any. The
 * `--intent` route owns the plan, the guide links, the per-phase check-ins,
 * the refusal when a prerequisite is missing, and the proof step; prose copied
 * here would duplicate all of that and then drift from it the next time the
 * underlying API changes.
 *
 * What is left is the caller's own business: identify yourself, run this
 * command, and the standing permission for the session check that the
 * developer granted by copying the prompt.
 */
export const FEATURE_ONBOARDING_PROMPT_TEMPLATE =
  "Help me set this up in my CopilotKit app. Run this command and follow the " +
  "instructions:\n\nnpx --yes copilotkit@latest onboard start --run " +
  `${RUN_ID_PLACEHOLDER} --intent ${INTENT_PLACEHOLDER}` +
  "\n\nIf it requires a CopilotKit CLI session check, you have permission to " +
  "run it. Never reveal credentials or send optional diagnostic feedback " +
  "reports.";

/** Bind one run id and one tile's feature outcome into the copied prompt. */
export function createFeatureOnboardingPrompt(
  serviceId: HomeServiceId,
  runId: string,
): string {
  return FEATURE_ONBOARDING_PROMPT_TEMPLATE.replace(
    RUN_ID_PLACEHOLDER,
    runId,
  ).replace(INTENT_PLACEHOLDER, FEATURE_ONBOARDING_INTENT[serviceId]);
}
