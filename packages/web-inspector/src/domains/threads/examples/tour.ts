import type { ThreadDetailsTab } from "../detail/thread-inspector.js";
import type { ThreadsState } from "../state.js";

export const THREADS_EXAMPLE_TOUR_STORAGE_KEY =
  "cpk:inspector:threads-example-tour:v1";

export const THREADS_EXAMPLE_TOUR_STEPS: ReadonlyArray<{
  tab: ThreadDetailsTab;
  label: string;
  title: string;
  body: string;
}> = [
  {
    tab: "timeline",
    label: "Messages",
    title: "Read the run as a story",
    body: "The timeline turns messages, tool calls, state changes, and run markers into a scannable debugging trail.",
  },
  {
    tab: "raw-events",
    label: "AG-UI Events",
    title: "Drop into the protocol payloads",
    body: "Raw events show the exact AG-UI stream behind the timeline when you need to verify ordering or payload shape.",
  },
  {
    tab: "state",
    label: "State",
    title: "Check the durable state",
    body: "The state tab shows the saved values that make a thread resumable across sessions.",
  },
];

export type ExampleTourTelemetryPair = Readonly<{
  tour_step: 1 | 2 | 3;
  tour_tab: "timeline" | "raw-events" | "state";
}>;

export function getExampleTourTelemetryPair(
  index: number,
): ExampleTourTelemetryPair | undefined {
  switch (index) {
    case 0:
      return { tour_step: 1, tour_tab: "timeline" };
    case 1:
      return { tour_step: 2, tour_tab: "raw-events" };
    case 2:
      return { tour_step: 3, tour_tab: "state" };
    default:
      return undefined;
  }
}

export function startExampleTour(
  state: ThreadsState,
  autoStarted: boolean,
): boolean {
  if (!state.selectedThreadId) return false;
  state.exampleTourActive = true;
  state.exampleTourStep = 0;
  if (autoStarted) state.exampleTourAutoShown = true;
  return true;
}

export function setExampleTourStep(
  state: ThreadsState,
  nextStep: number,
): boolean {
  const validForTelemetry = getExampleTourTelemetryPair(nextStep) !== undefined;
  state.exampleTourStep = Math.max(
    0,
    Math.min(THREADS_EXAMPLE_TOUR_STEPS.length - 1, nextStep),
  );
  return validForTelemetry;
}

export function dismissExampleTour(state: ThreadsState): boolean {
  if (!state.selectedThreadId) return false;
  state.exampleTourActive = false;
  state.exampleTourDismissed = true;
  return true;
}

export function readExampleTourDismissed(win: Window | null): boolean {
  try {
    const raw = win?.localStorage.getItem(THREADS_EXAMPLE_TOUR_STORAGE_KEY);
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    return (
      typeof value === "object" &&
      value !== null &&
      "dismissed" in value &&
      value.dismissed === true
    );
  } catch {
    return false;
  }
}

export function writeExampleTourDismissed(win: Window | null): void {
  try {
    win?.localStorage.setItem(
      THREADS_EXAMPLE_TOUR_STORAGE_KEY,
      JSON.stringify({ dismissed: true }),
    );
  } catch {
    // Storage can be blocked in privacy-focused browser contexts.
  }
}
