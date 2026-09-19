import type {
  InspectorErrorSignalSource,
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
} from "../../shared/telemetry/privacy.js";
import type { MenuKey } from "../navigation/model.js";
import type { LauncherSignalKey } from "./model.js";

export type InspectorEventErrorDetails = Readonly<{
  message: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
}>;

export type LauncherPillPhase = "closed" | "opening" | "holding" | "closing";
export type LauncherPillDirection = "left" | "right";
export type LauncherPillOutcome = "shown" | "suppressed";

export type LauncherState = {
  newsSignalArmed: boolean;
  pulsingSignal: LauncherSignalKey | null;
  pendingPulseSignal: LauncherSignalKey | null;
  pulseTimeoutId: ReturnType<typeof setTimeout> | null;
  errorSignalArmed: Record<InspectorWiringErrorSource, boolean>;
  eventErrorArmed: Record<InspectorEventErrorSource, boolean>;
  eventErrorDetails: Record<
    InspectorEventErrorSource,
    InspectorEventErrorDetails | null
  >;
  errorBeatSpent: boolean;
  errorSignalViewedSources: Set<InspectorErrorSignalSource>;
  gestureSignal: LauncherSignalKey | null;
  pillPhase: LauncherPillPhase | null;
  pillDirection: LauncherPillDirection | null;
  pillTimeoutId: ReturnType<typeof setTimeout> | null;
  pillOutcome: LauncherPillOutcome | null;
  hudOpen: boolean;
  hudSide: "left" | "right";
  hudCloseTimer: ReturnType<typeof setTimeout> | null;
  hudIntro: boolean;
  hudIntroStartTimer: ReturnType<typeof setTimeout> | null;
  hudIntroEndTimer: ReturnType<typeof setTimeout> | null;
  hudLandingMenu: MenuKey | null;
};

export function createLauncherState(): LauncherState {
  return {
    newsSignalArmed: false,
    pulsingSignal: null,
    pendingPulseSignal: null,
    pulseTimeoutId: null,
    errorSignalArmed: { connection: false, threads: false },
    eventErrorArmed: { run: false, tool: false, memory: false },
    eventErrorDetails: { run: null, tool: null, memory: null },
    errorBeatSpent: false,
    errorSignalViewedSources: new Set(),
    gestureSignal: null,
    pillPhase: null,
    pillDirection: null,
    pillTimeoutId: null,
    pillOutcome: null,
    hudOpen: false,
    hudSide: "left",
    hudCloseTimer: null,
    hudIntro: false,
    hudIntroStartTimer: null,
    hudIntroEndTimer: null,
    hudLandingMenu: null,
  };
}
