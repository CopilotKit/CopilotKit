import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import { WEB_INSPECTOR_TAG } from "@copilotkit/web-inspector";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

import {
  ALL_SCENARIO_KEYS,
  CORE_SCENARIO_KEYS,
  LEARNING_SCENARIO_KEYS,
  THREAD_REQUEST_KINDS,
  canonicalScenarioUrl,
  clearThreadsStateLabNotificationState,
  clearThreadsStateLabStorage,
  consumedNotificationReplayUrl,
  getThreadsStateScenario,
  installThreadsStateLabNavigation,
  installThreadsStateLabReducedMotion,
  notificationReplayUrl,
  parseScenarioKey,
  runtimeUrlFor,
  seedThreadsStateLabAgentEvents,
  stopThreadsStateLabClient,
} from "./threads-state-lab.js";
import type {
  ScenarioKey,
  ThreadRequestKind,
  ThreadsStateScenario,
} from "./threads-state-lab.js";
import type { ThreadRequestLog } from "./threads-state-lab-server.js";

const scenarioSelect = requiredElement<HTMLSelectElement>("#scenario-select");
const notificationField = requiredElement<HTMLElement>("#notification-field");
const notificationSource = requiredElement<HTMLSelectElement>(
  "#notification-source",
);
const notificationCustomControls = requiredElement<HTMLElement>(
  "#notification-custom-controls",
);
const notificationCustomText = requiredElement<HTMLInputElement>(
  "#notification-custom-text",
);
const applyNotificationButton = requiredElement<HTMLButtonElement>(
  "#apply-notification",
);
const copyButton = requiredElement<HTMLButtonElement>("#copy-link");
const replayNotificationButton = requiredElement<HTMLButtonElement>(
  "#replay-notification",
);
const resetButton = requiredElement<HTMLButtonElement>("#reset-scenario");
const actionStatus = requiredElement<HTMLElement>("#action-status");
const routeAlert = requiredElement<HTMLElement>("#route-alert");
const fixtureOutput = requiredElement<HTMLElement>("#fixture-json");
const requestLogOutput = requiredElement<HTMLOListElement>("#request-log");
const ledgerStatus = requiredElement<HTMLElement>("#ledger-status");
const runtimeStatus = requiredElement<HTMLElement>("#runtime-status");
const mediaStatus = requiredElement<HTMLElement>("#media-status");
const inspectorHost = requiredElement<HTMLElement>("#inspector-host");

const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
const NOTIFICATION_SOURCE_QUERY_KEY = "notification";
const NOTIFICATION_TEXT_QUERY_KEY = "notification-text";

type NotificationConfig =
  | Readonly<{ source: "live" }>
  | Readonly<{ source: "custom"; text: string }>;

const query = new URLSearchParams(window.location.search);
const replayingNotification = query.get("replay-notification") === "1";
const parsedScenario = parseScenarioKey(query.get("scenario"));
const scenario = getThreadsStateScenario(parsedScenario.scenarioKey);
const customNotificationText = query.get(NOTIFICATION_TEXT_QUERY_KEY)?.trim();
const notificationConfig: NotificationConfig =
  query.get(NOTIFICATION_SOURCE_QUERY_KEY) === "custom" &&
  customNotificationText
    ? { source: "custom", text: customNotificationText }
    : { source: "live" };
const runtimeUrl = runtimeUrlFor(window.location.origin, scenario.key);
const requestLogUrl = `${runtimeUrl}/request-log`;

let core: CopilotKitCore | null = null;
let inspector: WebInspectorElement | null = null;
let coreUnsubscribe: (() => void) | null = null;
let ledgerAbortController: AbortController | null = null;
let ledgerTimer: number | null = null;
let mediaTimer: number | null = null;
let restoreMatchMedia: (() => void) | null = null;
let teardownStarted = false;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing lab element: ${selector}`);
  return element;
}

function applyNotificationQuery(url: URL, config: NotificationConfig): URL {
  url.searchParams.delete(NOTIFICATION_SOURCE_QUERY_KEY);
  url.searchParams.delete(NOTIFICATION_TEXT_QUERY_KEY);
  if (config.source === "custom") {
    url.searchParams.set(NOTIFICATION_SOURCE_QUERY_KEY, "custom");
    url.searchParams.set(NOTIFICATION_TEXT_QUERY_KEY, config.text);
  }
  return url;
}

function notificationPreviewUrl(config: NotificationConfig): string {
  const url = applyNotificationQuery(new URL(window.location.href), config);
  url.searchParams.delete("reset");
  url.searchParams.set("replay-notification", "1");
  return url.toString();
}

function customNotificationTimestamp(text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  const offsetWithinDay = (hash >>> 0) % 86_400_000;
  return new Date(Date.UTC(2026, 8, 1) + offsetWithinDay).toISOString();
}

function escapeMarkdownText(text: string): string {
  const markdownSyntax = "\\`*[]{}()#+.!|>~-_";
  return Array.from(text, (character) =>
    markdownSyntax.includes(character) ? `\\${character}` : character,
  ).join("");
}

function installCustomNotificationResponse(config: NotificationConfig): void {
  if (config.source !== "custom") return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const requestedUrl =
      typeof input === "string"
        ? new URL(input, window.location.href).href
        : input instanceof URL
          ? input.href
          : input.url;
    if (requestedUrl !== ANNOUNCEMENT_URL) {
      return nativeFetch(input, init);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          timestamp: customNotificationTimestamp(config.text),
          previewText: config.text,
          announcement: `## Workbench preview\n\n${escapeMarkdownText(config.text)}`,
        }),
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/json",
          },
          status: 200,
        },
      ),
    );
  };
}

function renderNotificationEditor(config: NotificationConfig): void {
  notificationSource.value = config.source;
  notificationField.dataset.source = config.source;
  const custom = config.source === "custom";
  notificationCustomControls.hidden = !custom;
  notificationCustomText.value = custom ? config.text : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestKind(value: unknown): value is ThreadRequestKind {
  return (
    typeof value === "string" &&
    (THREAD_REQUEST_KINDS as readonly string[]).includes(value)
  );
}

function parseRequestLog(value: unknown): ThreadRequestLog {
  if (!isRecord(value) || !isRecord(value.counters)) {
    throw new Error("The lab Runtime returned an invalid request ledger.");
  }
  const counters = {
    list: 0,
    subscribe: 0,
    inspect: 0,
    messages: 0,
    events: 0,
    state: 0,
  };
  for (const kind of THREAD_REQUEST_KINDS) {
    const count = value.counters[kind];
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error(`The lab Runtime returned an invalid ${kind} count.`);
    }
    counters[kind] = count;
  }
  if (!Array.isArray(value.entries)) {
    throw new Error("The lab Runtime returned invalid request entries.");
  }
  const entries = value.entries.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.sequence !== "number" ||
      !isRequestKind(entry.kind) ||
      typeof entry.method !== "string" ||
      typeof entry.path !== "string"
    ) {
      throw new Error("The lab Runtime returned an invalid request entry.");
    }
    return {
      sequence: entry.sequence,
      kind: entry.kind,
      method: entry.method,
      path: entry.path,
    };
  });
  return { counters, entries };
}

function populateScenarioSelect(): void {
  const coreGroup = document.createElement("optgroup");
  coreGroup.label = "Plan and capability matrix";
  const learningGroup = document.createElement("optgroup");
  learningGroup.label = "Automatic Learning";
  const edgeGroup = document.createElement("optgroup");
  edgeGroup.label = "Edge cases";
  for (const key of ALL_SCENARIO_KEYS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = getThreadsStateScenario(key).label;
    option.selected = key === scenario.key;
    if (CORE_SCENARIO_KEYS.some((coreKey) => coreKey === key)) {
      coreGroup.append(option);
    } else if (
      LEARNING_SCENARIO_KEYS.some((learningKey) => learningKey === key)
    ) {
      learningGroup.append(option);
    } else {
      edgeGroup.append(option);
    }
  }
  scenarioSelect.replaceChildren(coreGroup, learningGroup, edgeGroup);
}

function renderFixture(): void {
  const visibleFixture = {
    key: scenario.key,
    label: scenario.label,
    description: scenario.description,
    deployment: scenario.deployment,
    plan: scenario.plan,
    capability: scenario.capability,
    data: scenario.data,
    runtimeInfo: scenario.runtimeInfo,
    inspectorMetadataBody: scenario.inspectorMetadataBody ?? null,
    threads: scenario.threads,
    learning: scenario.learning,
    memories: scenario.memories,
    expectedNewestThreadId: scenario.expectedNewestThreadId ?? null,
    expectedInitialRequests: scenario.expectedRequests,
    media: scenario.media,
  };
  fixtureOutput.textContent = JSON.stringify(visibleFixture, null, 2);
}

function renderLedger(log: ThreadRequestLog): void {
  let pending = 0;
  let unexpected = 0;
  for (const kind of THREAD_REQUEST_KINDS) {
    const expected = scenario.expectedRequests[kind];
    const actual = log.counters[kind];
    const actualCell = requiredElement<HTMLElement>(`#actual-${kind}`);
    const outcomeCell = requiredElement<HTMLElement>(`#outcome-${kind}`);
    actualCell.textContent = String(actual);
    if (actual < expected) {
      pending += 1;
      outcomeCell.textContent = "Pending";
      outcomeCell.dataset.state = "pending";
    } else if (actual > expected && scenario.capability !== "enabled") {
      unexpected += 1;
      outcomeCell.textContent = "Unexpected";
      outcomeCell.dataset.state = "error";
    } else if (actual > expected) {
      outcomeCell.textContent = "Interaction";
      outcomeCell.dataset.state = "interaction";
    } else {
      outcomeCell.textContent = "Match";
      outcomeCell.dataset.state = "match";
    }
  }

  requestLogOutput.replaceChildren(
    ...log.entries.map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.sequence}. ${entry.kind} · ${entry.method} ${entry.path}`;
      return item;
    }),
  );
  if (log.entries.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No Thread requests recorded.";
    requestLogOutput.append(empty);
  }

  if (unexpected > 0) {
    ledgerStatus.textContent = `${unexpected} unexpected Thread request${unexpected === 1 ? "" : "s"}.`;
    ledgerStatus.dataset.state = "error";
    document.body.dataset.labReady = "error";
  } else if (pending > 0) {
    ledgerStatus.textContent = `Waiting for ${pending} initial request ${pending === 1 ? "kind" : "kinds"}.`;
    ledgerStatus.dataset.state = "pending";
  } else {
    ledgerStatus.textContent = "Initial request ledger matches the fixture.";
    ledgerStatus.dataset.state = "match";
    document.body.dataset.labReady = "true";
  }
}

async function fetchRequestLog(
  signal?: AbortSignal,
): Promise<ThreadRequestLog> {
  const response = await fetch(requestLogUrl, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Request log failed with HTTP ${response.status}.`);
  }
  return parseRequestLog(await response.json());
}

async function refreshLedger(): Promise<void> {
  if (teardownStarted) return;
  ledgerAbortController?.abort();
  const controller = new AbortController();
  ledgerAbortController = controller;
  try {
    renderLedger(await fetchRequestLog(controller.signal));
  } catch (error) {
    if (controller.signal.aborted) return;
    ledgerStatus.textContent =
      error instanceof Error ? error.message : "Request log failed.";
    ledgerStatus.dataset.state = "error";
  }
  if (!teardownStarted) {
    ledgerTimer = window.setTimeout(() => {
      refreshLedger().catch(reportFatalError);
    }, 350);
  }
}

function findButtonsDeep(
  root: Document | ShadowRoot | Element,
): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const element of root.querySelectorAll("*")) {
    if (element instanceof HTMLButtonElement) buttons.push(element);
    if (element.shadowRoot)
      buttons.push(...findButtonsDeep(element.shadowRoot));
  }
  return buttons;
}

function deepText(root: Document | ShadowRoot | Element): string {
  const parts = [root.textContent ?? ""];
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) parts.push(deepText(element.shadowRoot));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function updateMediaStatus(): void {
  if (!inspector?.shadowRoot) {
    mediaStatus.textContent = `${scenario.media} · Inspector not mounted`;
    return;
  }
  const text = deepText(inspector.shadowRoot);
  const mediaButton = findButtonsDeep(inspector.shadowRoot).find((button) => {
    const label = button.textContent?.trim();
    return label === "Play demo" || label === "Pause demo";
  });
  if (text.includes("The demo video is unavailable.")) {
    mediaStatus.textContent = `${scenario.media} · fallback visible`;
  } else if (mediaButton) {
    mediaStatus.textContent = `${scenario.media} · ${mediaButton.textContent?.trim() ?? "control visible"}`;
  } else if (scenario.data === "existing") {
    mediaStatus.textContent = `${scenario.media} · not shown for saved threads`;
  } else {
    mediaStatus.textContent = `${scenario.media} · waiting for demo media`;
  }
}

async function waitForButton(
  predicate: (button: HTMLButtonElement) => boolean,
  label: string,
): Promise<HTMLButtonElement> {
  const started = performance.now();
  return new Promise<HTMLButtonElement>((resolve, reject) => {
    const inspectFrame = (): void => {
      const currentInspector = inspector;
      const button = currentInspector?.shadowRoot
        ? findButtonsDeep(currentInspector.shadowRoot).find(predicate)
        : undefined;
      if (button) {
        resolve(button);
        return;
      }
      if (performance.now() - started > 8_000) {
        reject(new Error(`Timed out waiting for ${label}.`));
        return;
      }
      window.requestAnimationFrame(inspectFrame);
    };
    inspectFrame();
  });
}

async function openInspectorSurface(
  initialMenu: ThreadsStateScenario["initialMenu"] = "threads",
): Promise<void> {
  const launcher = await waitForButton(
    (button) => button.getAttribute("aria-label") === "Web Inspector",
    "the Web Inspector launcher",
  );
  launcher.click();
  if (initialMenu !== "home") {
    const menuLabel = initialMenu === "memories" ? "Learning" : "Threads";
    const menuButton = await waitForButton(
      (button) => button.textContent?.trim() === menuLabel,
      `the ${menuLabel} navigation button`,
    );
    menuButton.click();
  }
}

async function resetServerLedger(): Promise<void> {
  const response = await fetch(`${requestLogUrl}/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Ledger reset failed with HTTP ${response.status}.`);
  }
}

function stopClientState(): void {
  ledgerAbortController?.abort();
  ledgerAbortController = null;
  if (ledgerTimer !== null) window.clearTimeout(ledgerTimer);
  if (mediaTimer !== null) window.clearInterval(mediaTimer);
  ledgerTimer = null;
  mediaTimer = null;
  coreUnsubscribe?.();
  coreUnsubscribe = null;

  const priorCore = core;
  const priorInspector = inspector;
  stopThreadsStateLabClient(priorCore, priorInspector);
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  inspector = null;
  core = null;
}

async function teardownAndReset(): Promise<void> {
  if (teardownStarted) return;
  teardownStarted = true;
  stopClientState();
  await resetServerLedger();
}

async function navigateToScenario(key: ScenarioKey): Promise<void> {
  actionStatus.textContent = "Closing the current fixture…";
  await teardownAndReset();
  const directLink = applyNotificationQuery(
    new URL(canonicalScenarioUrl(window.location.origin, key)),
    notificationConfig,
  );
  window.location.assign(directLink.href);
}

async function copyDirectLink(): Promise<void> {
  const directLink = applyNotificationQuery(
    new URL(canonicalScenarioUrl(window.location.origin, scenario.key)),
    notificationConfig,
  );
  await navigator.clipboard.writeText(directLink.href);
  actionStatus.textContent = "Direct link copied.";
}

function handleNotificationSourceChange(): void {
  if (notificationSource.value === "live") {
    if (notificationConfig.source === "custom") {
      actionStatus.textContent = "Loading the live announcement…";
      window.location.assign(notificationPreviewUrl({ source: "live" }));
      return;
    }
    renderNotificationEditor({ source: "live" });
    actionStatus.textContent = "Using the live announcement.";
    return;
  }

  notificationField.dataset.source = "custom";
  notificationCustomControls.hidden = false;
  notificationCustomText.value =
    notificationConfig.source === "custom" ? notificationConfig.text : "";
  actionStatus.textContent = "Write a custom notification, then apply it.";
  notificationCustomText.focus();
}

function applyCustomNotification(): void {
  const text = notificationCustomText.value.trim();
  if (!text) {
    notificationCustomText.setCustomValidity("Write notification text first.");
    notificationCustomText.reportValidity();
    return;
  }
  notificationCustomText.setCustomValidity("");
  actionStatus.textContent = "Loading the custom notification…";
  window.location.assign(notificationPreviewUrl({ source: "custom", text }));
}

function replayNotification(): void {
  actionStatus.textContent = "Re-arming the launcher notification…";
  window.location.assign(notificationReplayUrl(window.location.href));
}

function reportFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  actionStatus.textContent = message;
  actionStatus.dataset.state = "error";
  console.error("[Inspector Threads lab]", error);
}

async function boot(): Promise<void> {
  populateScenarioSelect();
  renderNotificationEditor(notificationConfig);
  installCustomNotificationResponse(notificationConfig);
  renderFixture();
  document.title = `${scenario.label} · Inspector Threads lab`;
  document.body.dataset.scenario = scenario.key;

  if (parsedScenario.rejectedKey) {
    routeAlert.hidden = false;
    routeAlert.textContent = `Unknown scenario “${parsedScenario.rejectedKey}”. Showing ${scenario.label}.`;
  }

  for (const kind of THREAD_REQUEST_KINDS) {
    requiredElement<HTMLElement>(`#expected-${kind}`).textContent = String(
      scenario.expectedRequests[kind],
    );
  }

  if (scenario.media === "reduced_motion") {
    restoreMatchMedia = installThreadsStateLabReducedMotion(window);
  }

  if (replayingNotification) {
    clearThreadsStateLabNotificationState(
      window.localStorage,
      window.sessionStorage,
      document,
    );
    window.history.replaceState(
      null,
      "",
      consumedNotificationReplayUrl(window.location.href),
    );
  }

  if (query.get("reset") === "1") {
    clearThreadsStateLabStorage(window.localStorage);
    await resetServerLedger();
    actionStatus.textContent = "Inspector state and fixture ledger reset.";
  }

  core = new CopilotKitCore({
    runtimeUrl,
    runtimeTransport: "rest",
    deferInitialConnection: true,
  });
  inspector = document.createElement(WEB_INSPECTOR_TAG);
  inspector.setAttribute("auto-attach-core", "false");
  inspector.core = core;
  inspectorHost.replaceChildren(inspector);

  coreUnsubscribe = core.subscribe({
    onRuntimeConnectionStatusChanged: ({ status }) => {
      runtimeStatus.textContent = status;
      runtimeStatus.dataset.state = status;
    },
  }).unsubscribe;
  runtimeStatus.textContent = CopilotKitCoreRuntimeConnectionStatus.Connecting;
  core.connect();

  refreshLedger().catch(reportFatalError);
  mediaTimer = window.setInterval(updateMediaStatus, 400);
  updateMediaStatus();
  seedThreadsStateLabAgentEvents(inspector, scenario);
  await inspector.updateComplete;
  if (replayingNotification) {
    actionStatus.textContent = "";
  } else {
    await openInspectorSurface(scenario.initialMenu);
    actionStatus.textContent = "";
  }
}

const removeNavigationListeners = installThreadsStateLabNavigation(
  scenarioSelect,
  resetButton,
  scenario.key,
  navigateToScenario,
  reportFatalError,
);
copyButton.addEventListener("click", () => {
  copyDirectLink().catch(reportFatalError);
});
replayNotificationButton.addEventListener("click", replayNotification);
notificationSource.addEventListener("change", handleNotificationSourceChange);
notificationCustomText.addEventListener("input", () => {
  notificationCustomText.setCustomValidity("");
});
notificationCustomText.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applyCustomNotification();
});
applyNotificationButton.addEventListener("click", applyCustomNotification);
window.addEventListener(
  "pagehide",
  () => {
    removeNavigationListeners();
    stopClientState();
  },
  {
    once: true,
  },
);

boot().catch(reportFatalError);
