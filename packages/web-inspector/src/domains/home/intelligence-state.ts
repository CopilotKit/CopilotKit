import {
  createOnboardingPrompt,
  createOnboardingRunId,
} from "./onboarding-prompt.js";

export const INTELLIGENCE_STORY_BEATS = [
  {
    id: "threads",
    label: "Threads",
    duration: 6_500,
    lead: "You only see this session. Your users have all the others.",
    support:
      "Rich Threads keep every conversation and its state, so you can open the one that broke instead of reproducing it.",
  },
  {
    id: "learning",
    label: "Learning",
    duration: 6_000,
    lead: "Your users already told you what to fix.",
    support:
      "Learning reads the runs behind those threads and finds the patterns — every Insight linked to the messages that back it.",
  },
  {
    id: "skill",
    label: "Skills",
    duration: 5_500,
    lead: "An Insight becomes a skill you own.",
    support:
      "A SKILL.md built from that evidence — yours to review, edit and ship with your project.",
  },
  {
    id: "intelligence",
    label: "Intelligence",
    duration: 6_000,
    lead: "Every round of real use leaves your agent better.",
    support:
      "Approve a skill, pull it into your project, and the next run starts from what already worked.",
  },
] as const;

export type IntelligenceStoryBeat = (typeof INTELLIGENCE_STORY_BEATS)[number];

export type IntelligencePromptCopyState = "idle" | "copied" | "failed";
export type IntelligencePromptCopyOutcome = Exclude<
  IntelligencePromptCopyState,
  "idle"
>;

export type HomeIntelligenceState = {
  onboardingRunId: string | null;
  promptCopyState: IntelligencePromptCopyState;
  promptCopyResetTimer: ReturnType<typeof setTimeout> | null;
  storyBeat: number;
  storyUserPinned: boolean;
  storyTimer: ReturnType<typeof setTimeout> | null;
};

export function createHomeIntelligenceState() {
  return {
    onboardingRunId: null,
    promptCopyState: "idle",
    promptCopyResetTimer: null,
    storyBeat: 0,
    storyUserPinned: false,
    storyTimer: null,
  } satisfies HomeIntelligenceState;
}

export function getIntelligenceOnboardingRunId(state: HomeIntelligenceState) {
  state.onboardingRunId ??= createOnboardingRunId();
  return state.onboardingRunId;
}

export function getIntelligenceOnboardingPrompt(state: HomeIntelligenceState) {
  return createOnboardingPrompt(getIntelligenceOnboardingRunId(state));
}

export function clearIntelligencePromptReset(state: HomeIntelligenceState) {
  if (state.promptCopyResetTimer === null) return;
  clearTimeout(state.promptCopyResetTimer);
  state.promptCopyResetTimer = null;
}

export function scheduleIntelligencePromptReset(
  state: HomeIntelligenceState,
  isConnected: () => boolean,
  requestUpdate: () => void,
) {
  clearIntelligencePromptReset(state);
  state.promptCopyResetTimer = setTimeout(() => {
    state.promptCopyResetTimer = null;
    if (!isConnected() || state.promptCopyState !== "copied") return;
    state.promptCopyState = "idle";
    requestUpdate();
  }, 4_000);
}

export async function copyIntelligenceOnboardingPrompt(
  state: HomeIntelligenceState,
  options: {
    clipboard?: Pick<Clipboard, "writeText">;
    isConnected: () => boolean;
    requestUpdate: () => void;
    trackOutcome: (
      runId: string,
      outcome: IntelligencePromptCopyOutcome,
    ) => void;
  },
) {
  clearIntelligencePromptReset(state);
  const runId = getIntelligenceOnboardingRunId(state);
  let outcome: IntelligencePromptCopyOutcome = "failed";

  if (options.clipboard?.writeText) {
    try {
      await options.clipboard.writeText(createOnboardingPrompt(runId));
      outcome = "copied";
    } catch {
      outcome = "failed";
    }
  }

  if (!options.isConnected()) return;

  state.promptCopyState = outcome;
  options.requestUpdate();
  if (outcome === "copied") {
    scheduleIntelligencePromptReset(
      state,
      options.isConnected,
      options.requestUpdate,
    );
  }
  options.trackOutcome(runId, outcome);
}

export function stopIntelligenceStory(state: HomeIntelligenceState) {
  if (state.storyTimer === null) return;
  clearTimeout(state.storyTimer);
  state.storyTimer = null;
}

export function pinIntelligenceStoryBeat(
  state: HomeIntelligenceState,
  index: number,
  options: {
    requestUpdate: () => void;
    trackSelection: (beat: IntelligenceStoryBeat) => void;
  },
) {
  const beat = INTELLIGENCE_STORY_BEATS[index];
  if (!beat) return;

  state.storyUserPinned = true;
  state.storyBeat = index;
  stopIntelligenceStory(state);
  options.requestUpdate();
  options.trackSelection(beat);
}

export function syncIntelligenceStory(
  state: HomeIntelligenceState,
  options: {
    visible: boolean;
    reducedMotion: boolean;
    isConnected: () => boolean;
    requestUpdate: () => void;
  },
) {
  if (!options.visible) {
    state.storyUserPinned = false;
    stopIntelligenceStory(state);
    return;
  }

  if (state.storyUserPinned) {
    stopIntelligenceStory(state);
    return;
  }

  if (options.reducedMotion) {
    const finalBeat = INTELLIGENCE_STORY_BEATS.length - 1;
    if (state.storyBeat !== finalBeat) {
      state.storyBeat = finalBeat;
      options.requestUpdate();
    }
    stopIntelligenceStory(state);
    return;
  }

  if (state.storyTimer !== null) return;

  const advance = () => {
    const current = INTELLIGENCE_STORY_BEATS[state.storyBeat];
    state.storyTimer = setTimeout(() => {
      state.storyTimer = null;
      if (!options.isConnected()) return;
      state.storyBeat = (state.storyBeat + 1) % INTELLIGENCE_STORY_BEATS.length;
      options.requestUpdate();
      advance();
    }, current?.duration ?? 3_800);
  };

  advance();
}

export function disposeHomeIntelligenceState(state: HomeIntelligenceState) {
  clearIntelligencePromptReset(state);
  stopIntelligenceStory(state);
  state.promptCopyState = "idle";
  state.storyUserPinned = false;
}
