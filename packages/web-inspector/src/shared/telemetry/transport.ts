import packageJson from "../../../package.json" with { type: "json" };
import {
  getOrCreateTelemetryDistinctId,
  isTelemetryOptedOut,
} from "../persistence/telemetry.js";

export const TELEMETRY_EVENTS = {
  opened: "oss.inspector.opened",
  whatsNewViewed: "oss.inspector.whats_new_viewed",
  whatsNewSignalViewed: "oss.inspector.whats_new_signal_viewed",
  errorSignalViewed: "oss.inspector.error_signal_viewed",
  whatsNewClicked: "oss.inspector.whats_new_clicked",
  threadsTabClicked: "oss.inspector.threads_tab_clicked",
  threadsTryFromHereClicked: "oss.inspector.threads_try_from_here_clicked",
  threadsLockedViewed: "oss.inspector.threads_locked_viewed",
  threadsIntelligenceSignupClicked:
    "oss.inspector.threads_intelligence_signup_clicked",
  threadsTalkToEngineerClicked:
    "oss.inspector.threads_talk_to_engineer_clicked",
  talkToEngineerClicked: "oss.inspector.talk_to_engineer_clicked",
  threadsEmptyEnabledViewed: "oss.inspector.threads_empty_enabled_viewed",
  threadsEnabledViewed: "oss.inspector.threads_enabled_viewed",
  threadsExampleViewed: "oss.inspector.threads_example_viewed",
  threadsExampleSelected: "oss.inspector.threads_example_selected",
  threadsExampleTourStarted: "oss.inspector.threads_example_tour_started",
  threadsExampleTourStepViewed:
    "oss.inspector.threads_example_tour_step_viewed",
  threadsExampleTourDismissed: "oss.inspector.threads_example_tour_dismissed",
  threadsExampleTourCompleted: "oss.inspector.threads_example_tour_completed",
  threadsExampleTourReopened: "oss.inspector.threads_example_tour_reopened",
  memoriesTabClicked: "oss.inspector.memories_tab_clicked",
  homeViewed: "oss.inspector.home_viewed",
  homeCtaClicked: "oss.inspector.home_cta_clicked",
  homeFeaturePromptClicked: "oss.inspector.home_feature_prompt_clicked",
  homePromptCopied: "oss.inspector.home_prompt_copied",
  homeStoryBeatSelected: "oss.inspector.home_story_beat_selected",
  metadataModuleViewed: "oss.inspector.metadata_module_viewed",
  metadataActionClicked: "oss.inspector.metadata_action_clicked",
} as const;

export type TelemetryEvent =
  (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

export const TELEMETRY_INGEST_URL = "https://telemetry.copilotkit.ai/ingest";

const PACKAGE_NAME = "@copilotkit/web-inspector";
const PACKAGE_VERSION = packageJson.version;
const FETCH_TIMEOUT_MS = 3000;

export function track(
  event: TelemetryEvent,
  properties: Record<string, unknown> = {},
): void {
  if (isTelemetryOptedOut()) return;

  try {
    const distinctId = getOrCreateTelemetryDistinctId();
    const body = JSON.stringify({
      event,
      properties: {
        ...properties,
        package_name: PACKAGE_NAME,
        package_version: PACKAGE_VERSION,
        inspector_distinct_id: distinctId,
        distinct_id: distinctId,
      },
      package: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
      ts: Math.floor(Date.now() / 1000),
    });
    void postBestEffort(TELEMETRY_INGEST_URL, body, distinctId);
  } catch {
    // Identity and serialization failures are best-effort too.
  }
}

async function postBestEffort(
  url: string,
  body: string,
  distinctId: string,
): Promise<void> {
  if (typeof fetch === "undefined") return;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CopilotKit-Telemetry-Id": distinctId,
      },
      body,
      signal: controller.signal,
    });
  } catch {
    // Telemetry must never break the host application.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
