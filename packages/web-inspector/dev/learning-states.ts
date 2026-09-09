import { CopilotKitCore } from "@copilotkit/core";
import {
  WEB_INSPECTOR_TAG,
  configureWebInspectorElement,
} from "@copilotkit/web-inspector";
import type { WebInspectorElement } from "@copilotkit/web-inspector";
import {
  learningLabRuntimeUrl,
  prepareLearningStateClient,
  readyIntegratedLearningState,
  settleLearningState,
  waitForLearningConnection,
} from "./learning-state-client.js";
import { isLearningScreenshotState } from "./learning-state-fixtures.js";
import type { LearningScreenshotState } from "./learning-state-fixtures.js";

const query = new URLSearchParams(window.location.search);
const requestedState = query.get("state");
const state: LearningScreenshotState = isLearningScreenshotState(requestedState)
  ? requestedState
  : "success";
const runtimeTransport =
  query.get("transport") === "single" ? "single" : "rest";
const runtimeState =
  query.get("fixture") === "pagination" ? "pagination" : state;
const preserveLearningSetup = query.get("preserveSetup") === "true";
prepareLearningStateClient({ state, preserveSetup: preserveLearningSetup });

const runtimeUrl = learningLabRuntimeUrl(window.location.origin, runtimeState);
const core = new CopilotKitCore({
  runtimeUrl,
  runtimeTransport,
  deferInitialConnection: true,
});
const inspector = configureWebInspectorElement(
  document.createElement(WEB_INSPECTOR_TAG),
  core,
);
document.querySelector("#inspector-host")?.replaceChildren(inspector);

async function boot(): Promise<void> {
  core.connect();
  await waitForLearningConnection(core);
  await readyIntegratedLearningState(state, inspector);
  await settleLearningState();
  document.body.dataset.state = state;
  document.body.dataset.transport = runtimeTransport;
  document.documentElement.dataset.ready = "true";
}

void boot().catch((error: unknown) => {
  document.documentElement.dataset.ready = "error";
  document.body.dataset.error =
    error instanceof Error ? error.message : String(error);
  console.error("[Inspector Learning lab]", error);
});

declare global {
  interface Window {
    __learningInspector?: WebInspectorElement;
  }
}

window.__learningInspector = inspector;
