import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { CopilotKitCore } from "@copilotkit/core";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

import { LEARNING_LAB_BASE_PATH } from "./learning-state-fixtures.js";
import type {
  LearningLabState,
  LearningScreenshotState,
} from "./learning-state-fixtures.js";

const LEARNING_SETUP_STORAGE_KEY = "cpk:inspector:learning-setup:v1";

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
    embeddedWorkbench?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
  }>,
): void {
  if (!options.preserveSetup) {
    window.localStorage.removeItem(LEARNING_SETUP_STORAGE_KEY);
  }
  const width = options.viewportWidth ?? window.innerWidth;
  const height = options.viewportHeight ?? window.innerHeight;
  const narrow = width <= 900;
  const floatInWorkbench = options.embeddedWorkbench === true && !narrow;
  const workbenchStage = floatInWorkbench
    ? document
        .querySelector<HTMLElement>(".inspector-stage")
        ?.getBoundingClientRect()
    : undefined;
  const workbenchHeader = floatInWorkbench
    ? document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect()
    : undefined;
  const windowOffset = floatInWorkbench
    ? {
        x: Math.round((workbenchStage?.left ?? 0) + 16),
        y: Math.round((workbenchHeader?.bottom ?? 0) + 12),
      }
    : undefined;
  const windowWidth = floatInWorkbench
    ? Math.max(320, Math.min(width - 32, (workbenchStage?.width ?? width) - 32))
    : narrow
      ? width - 32
      : width - 96;
  const windowHeight = floatInWorkbench
    ? Math.max(400, height - (windowOffset?.y ?? 0) - 16)
    : narrow
      ? height
      : height - 48;
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
        ...(windowOffset
          ? {
              anchor: { horizontal: "left", vertical: "top" },
              anchorOffset: windowOffset,
            }
          : {}),
        size: {
          width: windowWidth,
          height: windowHeight,
        },
        hasCustomPosition: floatInWorkbench,
      },
    }),
  );

  if (options.state === "copy-error") {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
    });
  }
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
    learningError: string | null;
  };
  internals.handleMenuSelect("memories");
  await inspector.updateComplete;

  if (state === "copy-error") {
    const landing = await waitFor(
      () =>
        inspector.shadowRoot?.querySelector<HTMLElement>(
          '[data-inspector-locked-feature="memory"]',
        ),
      "the existing Learning landing surface",
    );
    landing
      .querySelector<HTMLButtonElement>(
        '[data-inspector-feature-setup-prompt="threads"]',
      )
      ?.click();
    await waitFor(
      () => landing.querySelector('[data-copy-state="error"]'),
      "the landing copy error",
    );
    return;
  }

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
    "no-threads": "setup",
    "threads-available": "ready",
    success: "results",
    "insights-only": "results",
    "multiple-skills": "results",
    "new-threads": "results",
    "empty-results": "empty",
    "setup-error": "invalid",
    unsupported: "unsupported",
    loading: "loading",
    "data-error": "error",
    "selection-required": "selection_required",
    "first-run": "first_run",
    "candidates-only": "results",
    "results-error": "results",
    "results-evidence": "results",
    "evidence-unavailable": "results",
    "setup-prompt": "invalid",
    landing: "landing",
    "copy-error": "landing",
  };
  await waitFor(
    () =>
      view.shadowRoot?.querySelector(
        `[data-learning-state="${expectedState[state]}"]`,
      ),
    `${state} Learning state`,
  );

  if (state === "results-error") {
    internals.learningError =
      "Learning could not refresh. Existing results are still available.";
    inspector.requestUpdate();
    await inspector.updateComplete;
    await view.updateComplete;
  }
  if (state === "results-evidence" || state === "evidence-unavailable") {
    view.shadowRoot?.querySelector<HTMLButtonElement>(".insight-row")?.click();
    await view.updateComplete;
    await waitFor(
      () => view.shadowRoot?.querySelector(".detail-panel"),
      "Insight evidence",
    );
  }
  if (state === "setup-prompt") {
    view.shadowRoot?.querySelector<HTMLButtonElement>(".prompt-link")?.click();
    await view.updateComplete;
    await waitFor(
      () => view.shadowRoot?.querySelector('[role="dialog"]'),
      "the setup prompt",
    );
  }
}

export async function settleLearningState(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
