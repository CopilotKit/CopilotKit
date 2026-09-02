import {
  homeFeatureImplementationPrompt,
  type HomeServiceId,
  type HomeServiceTile,
} from "./model.js";

export type HomeFeaturePromptTarget = Pick<
  HomeServiceTile,
  "id" | "label" | "docsUrl"
>;

export type HomeFeaturePromptCopyState = "idle" | "copied" | "error";

export interface HomeFeatureSetupState {
  copyResult: {
    serviceId: HomeServiceId;
    state: Exclude<HomeFeaturePromptCopyState, "idle">;
  } | null;
  resetTimeoutId: number | null;
  generation: number;
}

export interface CopyHomeFeaturePromptOptions {
  clipboard?: Pick<Clipboard, "writeText">;
  createRunId: () => string;
  isConnected: () => boolean;
  requestUpdate: () => void;
  trackClick: (serviceId: HomeServiceId, onboardingRunId: string) => void;
  setTimeout?: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
}

export function createHomeFeatureSetupState(): HomeFeatureSetupState {
  return {
    copyResult: null,
    resetTimeoutId: null,
    generation: 0,
  };
}

export function homeFeaturePromptCopyState(
  state: HomeFeatureSetupState,
  serviceId: HomeServiceId,
): HomeFeaturePromptCopyState {
  return state.copyResult?.serviceId === serviceId
    ? state.copyResult.state
    : "idle";
}

function showCopyResult(
  state: HomeFeatureSetupState,
  serviceId: HomeServiceId,
  result: Exclude<HomeFeaturePromptCopyState, "idle">,
  generation: number,
  options: CopyHomeFeaturePromptOptions,
): void {
  if (!options.isConnected() || generation !== state.generation) return;
  const clearScheduled = options.clearTimeout ?? window.clearTimeout;
  const schedule = options.setTimeout ?? window.setTimeout;
  if (state.resetTimeoutId !== null) {
    clearScheduled(state.resetTimeoutId);
  }
  state.copyResult = { serviceId, state: result };
  options.requestUpdate();
  state.resetTimeoutId = schedule(() => {
    if (!options.isConnected() || generation !== state.generation) return;
    state.copyResult = null;
    state.resetTimeoutId = null;
    options.requestUpdate();
  }, 2_000);
}

export async function copyHomeFeaturePrompt(
  state: HomeFeatureSetupState,
  service: HomeFeaturePromptTarget,
  options: CopyHomeFeaturePromptOptions,
): Promise<void> {
  const generation = (state.generation += 1);
  const clearScheduled = options.clearTimeout ?? window.clearTimeout;
  if (state.resetTimeoutId !== null) {
    clearScheduled(state.resetTimeoutId);
    state.resetTimeoutId = null;
  }
  state.copyResult = null;
  options.requestUpdate();

  const onboardingRunId = options.createRunId();
  options.trackClick(service.id, onboardingRunId);
  if (!options.clipboard?.writeText) {
    showCopyResult(state, service.id, "error", generation, options);
    return;
  }

  try {
    await options.clipboard.writeText(
      homeFeatureImplementationPrompt(service, { onboardingRunId }),
    );
    showCopyResult(state, service.id, "copied", generation, options);
  } catch {
    showCopyResult(state, service.id, "error", generation, options);
  }
}

export function disposeHomeFeatureSetupState(
  state: HomeFeatureSetupState,
  clearScheduled: typeof window.clearTimeout = window.clearTimeout,
): void {
  state.generation += 1;
  if (state.resetTimeoutId !== null) {
    clearScheduled(state.resetTimeoutId);
    state.resetTimeoutId = null;
  }
  state.copyResult = null;
}
