import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { CopilotKitCore } from "@copilotkit/core";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

import { LEARNING_LAB_BASE_PATH } from "./learning-state-fixtures.js";
import type {
  LearningLabState,
  LearningScreenshotState,
} from "./learning-state-fixtures.js";

const LEARNING_SETUP_STORAGE_KEY = "cpk:inspector:learning-setup:v1";
const DEFAULT_FLOATING_WINDOW_SIZE = { width: 960, height: 740 };

export function learningLabRuntimeUrl(
  origin: string,
  state: LearningLabState,
): string {
  return `${origin}${LEARNING_LAB_BASE_PATH}/${state}`;
}

export function prepareLearningStateClient(
  options: Readonly<{
    state: LearningScreenshotState;
    preserveSetup?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
  }>,
): void {
  if (!options.preserveSetup && options.state !== "landing") {
    window.localStorage.removeItem(LEARNING_SETUP_STORAGE_KEY);
  }
  if (options.state === "setup-pending") {
    // Start after a successful prompt copy so the workbench exercises the
    // real waiting-for-setup path without requiring a manual click.
    window.localStorage.setItem(
      LEARNING_SETUP_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        runtimeUrl: learningLabRuntimeUrl(
          window.location.origin,
          options.state,
        ),
        agentId: "Checkout Assistant",
        startedAt: new Date().toISOString(),
      }),
    );
  }
  const width = options.viewportWidth ?? window.innerWidth;
  const height = options.viewportHeight ?? window.innerHeight;
  const narrow = width <= 900;
  const windowWidth = narrow
    ? width - 32
    : Math.min(DEFAULT_FLOATING_WINDOW_SIZE.width, width - 32);
  const windowHeight = narrow
    ? height
    : Math.min(DEFAULT_FLOATING_WINDOW_SIZE.height, height - 48);
  window.localStorage.setItem(
    "cpk:inspector:state",
    JSON.stringify({
      isOpen: true,
      hasOpenedInspector: true,
      selectedMenu: "memories",
      selectedContext: "Checkout Assistant",
      dockMode: narrow ? "docked-left" : "floating",
      sidebarCollapsed: false,
      colorSchemePreference: "light",
      window: {
        size: {
          width: windowWidth,
          height: windowHeight,
        },
        hasCustomPosition: false,
      },
    }),
  );
}

function waitFor<T>(
  read: () => T | null | undefined | false,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      const value = read();
      if (value) {
        resolve(value);
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}.`));
        return;
      }
      window.setTimeout(tick, 20);
    };
    tick();
  });
}

export async function waitForLearningConnection(
  core: CopilotKitCore,
): Promise<void> {
  if (
    core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected ||
    core.runtimeConnectionStatus === CopilotKitCoreRuntimeConnectionStatus.Error
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    const subscription = core.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        if (
          status !== CopilotKitCoreRuntimeConnectionStatus.Connected &&
          status !== CopilotKitCoreRuntimeConnectionStatus.Error
        ) {
          return;
        }
        subscription.unsubscribe();
        resolve();
      },
    });
  });
}

function learningView(inspector: WebInspectorElement) {
  return (
    inspector.shadowRoot?.querySelector<
      HTMLElement & { updateComplete: Promise<boolean> }
    >("cpk-learning-view") ?? null
  );
}

export async function readyIntegratedLearningState(
  state: LearningScreenshotState,
  inspector: WebInspectorElement,
): Promise<void> {
  await inspector.updateComplete;
  const internals = inspector as unknown as {
    handleMenuSelect: (key: "memories") => void;
  };
  internals.handleMenuSelect("memories");
  await inspector.updateComplete;

  if (state === "landing") {
    await waitFor(
      () =>
        inspector.shadowRoot?.querySelector<HTMLElement>(
          '[data-inspector-locked-feature="memory"]',
        ) ??
        learningView(inspector)?.shadowRoot?.querySelector(
          '[data-learning-state="setup"]',
        ),
      "the Learning landing or restored setup surface",
    );
    return;
  }

  const view = await waitFor(
    () => learningView(inspector),
    "the integrated Learning pane",
  );
  const expectedState: Record<LearningScreenshotState, string> = {
    "setup-pending": "setup",
    "no-threads": "setup",
    "threads-available": "ready",
    success: "results",
    "insights-only": "results",
    "multiple-skills": "results",
    "new-threads": "results",
    "empty-results": "empty",
    "setup-error": "invalid",
    loading: "loading",
    "data-error": "error",
    "selection-required": "selection_required",
    "first-run": "first_run",
    "candidates-only": "results",
    landing: "landing",
  };
  await waitFor(
    () =>
      view.shadowRoot?.querySelector(
        `[data-learning-state="${expectedState[state]}"]`,
      ),
    `${state} Learning state`,
  );
}

export async function settleLearningState(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
