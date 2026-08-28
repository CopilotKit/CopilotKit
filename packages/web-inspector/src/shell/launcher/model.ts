import { CopilotKitCoreErrorCode } from "@copilotkit/core";

import { MEMORY_LOAD_ERROR_LABEL } from "../../domains/learning/view.js";
import type {
  InspectorErrorSignalSource,
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
} from "../../shared/telemetry/privacy.js";
import type { MenuKey } from "../navigation/model.js";
import type { LauncherSignalTone } from "../styles.js";

export const NEWS_SIGNAL_ID = "whats-new" as const;

export type LauncherSignalKey =
  | typeof NEWS_SIGNAL_ID
  | InspectorErrorSignalSource;

export type LauncherSignalDefinition = Readonly<{
  tone: LauncherSignalTone;
  markerTarget: MenuKey;
  landingTarget: MenuKey;
  cadence: number;
  priority: number;
  accessibleLabel: string;
  pillLabel?: string;
}>;

export const ERROR_GESTURE_MS = {
  beat: 400,
  open: 250,
  hold: 2500,
  close: 250,
} as const;

const RUNTIME_ERROR_LABEL = "Runtime error";
const THREADS_LOAD_ERROR_LABEL = "Failed to load threads";
const AGENT_RUN_FAILED_LABEL = "Agent run failed";
const TOOL_ERROR_LABEL = "Tool error";

export const EVENT_ERROR_GUIDANCE: Readonly<
  Record<
    InspectorEventErrorSource,
    Readonly<{ title: string; advice?: string; highlight?: string }>
  >
> = {
  run: {
    title: AGENT_RUN_FAILED_LABEL,
    highlight: "The failed run event is highlighted below.",
  },
  tool: {
    title: TOOL_ERROR_LABEL,
    highlight: "The failed tool call is highlighted below.",
  },
  memory: {
    title: MEMORY_LOAD_ERROR_LABEL,
    advice:
      "Confirm CopilotKit Intelligence is connected, then retry Learning.",
  },
};

export const PILL_SUBLINE_LABEL = "Open Inspector for details";
export const LAUNCHER_BASE_LABEL = "Web Inspector";
export const LAUNCHER_UNREAD_LABEL = "What's new unread";
export const LAUNCHER_HUD_WIDTH = 258;

export const LAUNCHER_HUD_INTRO_MS = {
  delay: 500,
  duration: 3400,
  rowStart: 180,
  rowStagger: 170,
  rowDuration: 300,
  blockedRetry: 250,
} as const;

export type LauncherHudRowId =
  | "threads"
  | "learning";

export const HUD_INSPECTOR_LABEL = "CopilotKit Inspector";
export const HUD_ANNOUNCEMENT_TITLE_LIMIT = 80;
export const HUD_THREADS_LABEL = "Rich Threads";
export const HUD_LEARNING_LABEL = "Automatic Learning";
export const HUD_LEARN_MORE_LABEL = "Click to learn more";

export const LAUNCHER_SIGNALS: Readonly<
  Record<LauncherSignalKey, LauncherSignalDefinition>
> = {
  "whats-new": {
    tone: "news",
    markerTarget: NEWS_SIGNAL_ID,
    landingTarget: "home",
    cadence: 2100,
    priority: 0,
    accessibleLabel: "new content",
  },
  connection: {
    tone: "error",
    markerTarget: "home",
    landingTarget: "home",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 5,
    accessibleLabel: "runtime error",
    pillLabel: RUNTIME_ERROR_LABEL,
  },
  threads: {
    tone: "error",
    markerTarget: "threads",
    landingTarget: "threads",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 4,
    accessibleLabel: "thread loading error",
    pillLabel: THREADS_LOAD_ERROR_LABEL,
  },
  run: {
    tone: "error",
    markerTarget: "ag-ui-events",
    landingTarget: "ag-ui-events",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 3,
    accessibleLabel: "agent run failed",
    pillLabel: AGENT_RUN_FAILED_LABEL,
  },
  tool: {
    tone: "error",
    markerTarget: "agents",
    landingTarget: "agents",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 2,
    accessibleLabel: "tool error",
    pillLabel: TOOL_ERROR_LABEL,
  },
  memory: {
    tone: "error",
    markerTarget: "memories",
    landingTarget: "memories",
    cadence: ERROR_GESTURE_MS.beat,
    priority: 1,
    accessibleLabel: "learning error",
    pillLabel: MEMORY_LOAD_ERROR_LABEL,
  },
};

export const LAUNCHER_SIGNAL_PRIORITY_ORDER: ReadonlyArray<LauncherSignalKey> =
  (Object.keys(LAUNCHER_SIGNALS) as LauncherSignalKey[]).sort(
    (a, b) => LAUNCHER_SIGNALS[b].priority - LAUNCHER_SIGNALS[a].priority,
  );

export const WIRING_ERROR_KEYS = [
  "connection",
  "threads",
] as const satisfies ReadonlyArray<InspectorWiringErrorSource>;

export const EVENT_ERROR_KEYS = [
  "run",
  "tool",
  "memory",
] as const satisfies ReadonlyArray<InspectorEventErrorSource>;

export function isWiringErrorKey(
  key: LauncherSignalKey,
): key is InspectorWiringErrorSource {
  return (WIRING_ERROR_KEYS as readonly string[]).includes(key);
}

export function isEventErrorKey(key: string): key is InspectorEventErrorSource {
  return (EVENT_ERROR_KEYS as readonly string[]).includes(key);
}

export function isErrorSignalKey(
  key: LauncherSignalKey,
): key is InspectorErrorSignalSource {
  return isWiringErrorKey(key) || isEventErrorKey(key);
}

export function eventErrorKeyForCode(
  code: CopilotKitCoreErrorCode,
): InspectorEventErrorSource | null {
  switch (code) {
    case CopilotKitCoreErrorCode.TOOL_NOT_FOUND:
    case CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED:
    case CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED:
    case CopilotKitCoreErrorCode.AGENT_NOT_FOUND:
      return "tool";
    case CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED:
    case CopilotKitCoreErrorCode.AGENT_RUN_FAILED:
    case CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT:
    case CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT:
      return "run";
    default:
      return null;
  }
}
