import "../src/index.ts";
import type {
  CpkThreadInspector,
  ThreadDebuggerProvider,
  WebInspectorElement,
} from "../src/index.ts";
import {
  createThreadsLabCore,
  createThreadsLabScenarioFetch,
  disposeThreadsLabCore,
  getThreadsLabScenario,
  threadsLabScenarios,
} from "./threads-state-lab.ts";
import type { ThreadsLabScenarioKey } from "./threads-state-lab.ts";

type Scenario = "events" | "messages" | "raw";

const threadInspectorHost = document.querySelector<HTMLElement>(
  "#thread-inspector-host",
);
const threadsLabHost = document.querySelector<HTMLElement>("#threads-lab-host");
const modeButtons = document.querySelectorAll<HTMLButtonElement>("[data-mode]");
const detailControls = document.querySelector<HTMLElement>(
  "[data-controls='thread-detail']",
);
const labControls = document.querySelector<HTMLElement>(
  "[data-controls='threads-lab']",
);
const labTitle = document.querySelector<HTMLElement>("#scenario-title");
const labDescription = document.querySelector<HTMLElement>(
  "#scenario-description",
);
let currentThreadsLabCore: ReturnType<typeof createThreadsLabCore> | null =
  null;
const originalWindowFetch = window.fetch.bind(window);
let currentThreadsLabScenario: ThreadsLabScenarioKey = "locked";
const threadsExampleTourStorageKey = "cpk:inspector:threads-example-tour:v1";

if (!threadInspectorHost || !threadsLabHost) {
  throw new Error("Missing standalone inspector host element.");
}

const inspector = document.createElement(
  "cpk-thread-inspector",
) as CpkThreadInspector;

threadInspectorHost.appendChild(inspector);

const webInspector = document.createElement(
  "cpk-web-inspector",
) as WebInspectorElement;

threadsLabHost.appendChild(webInspector);

const scenarios: Record<
  Scenario,
  {
    label: string;
    threadId: string;
    provider: ThreadDebuggerProvider;
  }
> = {
  events: {
    label: "AG-UI events",
    threadId: "demo-events-thread",
    provider: {
      getThreadMetadata: async () => ({
        id: "demo-events-thread",
        name: "AG-UI event-backed thread",
        agentId: "demo-agent",
        endUserId: "demo-user",
        status: "completed",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:04.000Z",
      }),
      getEvents: async () => [
        {
          type: "RUN_STARTED",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { runId: "run-1" },
        },
        {
          type: "TEXT_MESSAGE_START",
          timestamp: "2026-06-25T10:00:01.000Z",
          payload: { messageId: "m1", role: "assistant" },
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          timestamp: "2026-06-25T10:00:02.000Z",
          payload: {
            messageId: "m1",
            delta: "Here is the event-derived timeline row.",
          },
        },
        {
          type: "TOOL_CALL_START",
          timestamp: "2026-06-25T10:00:03.000Z",
          payload: { toolCallId: "tc1", toolCallName: "lookup_docs" },
        },
        {
          type: "TOOL_CALL_ARGS",
          timestamp: "2026-06-25T10:00:03.250Z",
          payload: { toolCallId: "tc1", args: { query: "threads" } },
        },
        {
          type: "RUN_FINISHED",
          timestamp: "2026-06-25T10:00:04.000Z",
          payload: { runId: "run-1" },
        },
      ],
      getState: async () => ({ phase: "complete", selectedScenario: "events" }),
    },
  },
  messages: {
    label: "Messages only",
    threadId: "demo-messages-thread",
    provider: {
      getThreadMetadata: async () => ({
        id: "demo-messages-thread",
        name: "Message-backed thread",
        agentId: "demo-agent",
        endUserId: "demo-user",
        status: "completed",
      }),
      getEvents: async () => [],
      getMessages: async () => [
        {
          id: "u1",
          role: "user",
          content: "Show me the thread timeline.",
        },
        {
          id: "a1",
          role: "assistant",
          content: "This fallback is rendered from persisted messages.",
        },
      ],
      getState: async () => ({ selectedScenario: "messages" }),
    },
  },
  raw: {
    label: "Raw event only",
    threadId: "demo-raw-thread",
    provider: {
      getThreadMetadata: async () => ({
        id: "demo-raw-thread",
        name: "Raw event-backed thread",
        agentId: "demo-agent",
        endUserId: "demo-user",
        status: "active",
      }),
      getEvents: async () => [
        {
          type: "THREAD_STATE_WRITTEN",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: {
            checkpointId: "checkpoint-1",
            note: "Unsupported event types still render as raw timeline rows.",
          },
        },
      ],
      getState: async () => ({ selectedScenario: "raw" }),
    },
  },
};

function selectScenario(scenario: Scenario): void {
  const selected = scenarios[scenario];
  inspector.provider = selected.provider;
  inspector.threadId = selected.threadId;
  inspector.thread = null;

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-scenario]",
  )) {
    const active = button.dataset.scenario === scenario;
    button.setAttribute("aria-pressed", String(active));
    button.style.background = active ? "#eee6fe" : "#ffffff";
  }

  document.title = `CopilotKit Web Inspector Standalone - ${selected.label}`;
}

function selectThreadsLabScenario(scenarioKey: ThreadsLabScenarioKey): void {
  const selected = getThreadsLabScenario(scenarioKey);
  currentThreadsLabScenario = scenarioKey;
  if (currentThreadsLabCore) {
    disposeThreadsLabCore(currentThreadsLabCore);
  }
  currentThreadsLabCore = createThreadsLabCore(selected);
  window.fetch = createThreadsLabScenarioFetch(
    selected,
    originalWindowFetch,
  ).bind(window);
  webInspector.core = currentThreadsLabCore;

  const internals = webInspector as WebInspectorElement & {
    isOpen: boolean;
    selectedMenu: "threads";
    selectedThreadId?: string | null;
  };
  internals.isOpen = true;
  internals.selectedMenu = "threads";
  if (usesExampleThreads(scenarioKey)) {
    internals.selectedThreadId = null;
  }
  webInspector.requestUpdate();

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-threads-scenario]",
  )) {
    const active = button.dataset.threadsScenario === scenarioKey;
    button.setAttribute("aria-pressed", String(active));
    button.style.background = active ? "#eee6fe" : "#ffffff";
  }

  if (labTitle) {
    labTitle.textContent = selected.label;
  }
  if (labDescription) {
    labDescription.textContent = selected.description;
  }

  document.title = `CopilotKit Web Inspector Standalone - ${selected.label}`;
  scheduleThreadsPrototypePatch();
}

function resetThreadsTourState(): void {
  window.localStorage.removeItem(threadsExampleTourStorageKey);
  const internals = webInspector as WebInspectorElement & {
    exampleTourActive?: boolean;
    exampleTourAutoShown?: boolean;
    exampleTourDismissed?: boolean;
    exampleTourStep?: number;
    selectedThreadId?: string | null;
  };
  internals.exampleTourActive = false;
  internals.exampleTourAutoShown = false;
  internals.exampleTourDismissed = false;
  internals.exampleTourStep = 0;
  if (usesExampleThreads(currentThreadsLabScenario)) {
    internals.selectedThreadId = null;
  }
  webInspector.requestUpdate();
}

function selectMode(mode: "threads-lab" | "thread-detail"): void {
  const showingThreadsLab = mode === "threads-lab";
  threadsLabHost.hidden = !showingThreadsLab;
  threadInspectorHost.hidden = showingThreadsLab;
  if (detailControls) {
    detailControls.hidden = showingThreadsLab;
  }
  if (labControls) {
    labControls.hidden = !showingThreadsLab;
  }

  for (const button of modeButtons) {
    const active = button.dataset.mode === mode;
    button.setAttribute("aria-pressed", String(active));
    button.style.background = active ? "#010507" : "#ffffff";
    button.style.color = active ? "#ffffff" : "#010507";
  }

  if (showingThreadsLab) {
    scheduleThreadsPrototypePatch();
  }
}

function scheduleThreadsPrototypePatch(): void {
  for (const delay of [0, 50, 150, 400, 800]) {
    window.setTimeout(applyThreadsPrototypePatch, delay);
  }
}

function applyThreadsPrototypePatch(): void {
  const shadowRoot = webInspector.shadowRoot;
  if (!shadowRoot || threadsLabHost.hidden) return;
  cleanupLegacyThreadsPrototypePatch(shadowRoot);
}

function cleanupLegacyThreadsPrototypePatch(shadowRoot: ShadowRoot): void {
  shadowRoot.querySelector("[data-threads-audit-nav-cta]")?.remove();
  shadowRoot.querySelector("[data-threads-audit-intro-overlay]")?.remove();
  shadowRoot.querySelector("[data-threads-audit-tour]")?.remove();
  shadowRoot.querySelector("[data-threads-audit-show-tour]")?.remove();

  const talkLinks = findElementsDeep<HTMLAnchorElement>(
    shadowRoot,
    (element): element is HTMLAnchorElement =>
      element instanceof HTMLAnchorElement &&
      element.textContent?.trim() === "Talk to an Engineer",
  );

  for (const link of talkLinks) {
    link.style.removeProperty("display");
    const parent = link.parentElement;
    if (
      parent instanceof HTMLElement &&
      parent.style.display === "none" &&
      parent.textContent?.trim() === "Talk to an Engineer"
    ) {
      parent.style.removeProperty("display");
    }
  }
}

function usesExampleThreads(scenarioKey: ThreadsLabScenarioKey): boolean {
  return scenarioKey === "enabled-empty";
}

function findElementsDeep<T extends Element>(
  root: Document | DocumentFragment | Element,
  predicate: (element: Element) => element is T,
): T[] {
  const matches: T[] = [];
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (predicate(element)) {
      matches.push(element);
    }
    if (element.shadowRoot) {
      matches.push(...findElementsDeep(element.shadowRoot, predicate));
    }
  }
  return matches;
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-scenario]",
)) {
  button.addEventListener("click", () => {
    const scenario = button.dataset.scenario;
    if (
      scenario === "events" ||
      scenario === "messages" ||
      scenario === "raw"
    ) {
      selectScenario(scenario);
    }
  });
}

for (const scenario of threadsLabScenarios) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.threadsScenario = scenario.key;
  button.textContent = scenario.label;
  button.addEventListener("click", () =>
    selectThreadsLabScenario(scenario.key),
  );
  labControls?.appendChild(button);
}

const resetTourButton = document.createElement("button");
resetTourButton.type = "button";
resetTourButton.textContent = "Reset tour";
resetTourButton.title = "Clear the local Threads example tour dismissal state";
resetTourButton.addEventListener("click", resetThreadsTourState);
labControls?.appendChild(resetTourButton);

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    if (mode === "threads-lab" || mode === "thread-detail") {
      selectMode(mode);
    }
  });
}

selectScenario("events");
selectThreadsLabScenario("locked");
selectMode("threads-lab");
