import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable stubs for the page-surface plumbing the canvas drives.
const { usePageSurface, messagesRef } = vi.hoisted(() => ({
  usePageSurface: vi.fn(() => ({ available: true, rejected: [] as string[] })),
  // Mutable so a test can swap the agent's message stream between renders.
  messagesRef: { current: [] as unknown[] },
}));

// One surface activity whose op list carries a createSurface (so a surfaceId
// resolves) — the healthy case. The runtime streams it as a
// `generative-ui-surface` activity with the ops under `operations`.
const surfaceMessages = [
  {
    role: "activity",
    activityType: "generative-ui-surface",
    content: {
      operations: [{ createSurface: { surfaceId: "keel-ops-report" } }],
    },
  },
];

// A later surface activity with an empty op list — surfaceId resolves to null,
// so the canvas renders nothing.
const emptyMessages = [
  {
    role: "activity",
    activityType: "generative-ui-surface",
    content: { operations: [] },
  },
];

// The canvas reads its surface out of `agent.messages`; serve the mutable ref
// so a test can advance the stream.
vi.mock("@copilotkit/react-core", () => ({
  useAgent: () => ({ agent: { messages: messagesRef.current } }),
}));

vi.mock("@/shell/generative-ui/page-surface", () => ({ usePageSurface }));

vi.mock("@copilotkit/react-core/generative-ui", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@copilotkit/react-core/generative-ui")
  >()),
  GenerativeUISurface: ({ id }: { id: string }) => (
    <div data-testid="generative-ui-rendered">{id}</div>
  ),
}));

// The catalog's KPI/chart/table renderers bind live desk data.
// `GenerativeUISurface` is stubbed above, so none of them actually mounts here — but the stub keeps this
// file from reaching the real hook (and its ledger fetch) if one ever does.
vi.mock("@/skins/keel/desk-data", () => ({
  useKeelDesk: () => ({
    kpis: {
      openRuns: 0,
      blockedRuns: 0,
      approvalsForMe: 0,
      medianCycleTimeMs: null,
    },
    runs: [],
    playbooks: [],
  }),
}));

// Imported after the mocks so it binds the stubbed modules.
import { KeelCanvasSurface } from "./canvas-surface";

describe("KeelCanvasSurface error handling", () => {
  beforeEach(() => {
    usePageSurface.mockReset();
    usePageSurface.mockReturnValue({ available: true, rejected: [] });
    messagesRef.current = surfaceMessages;
  });
  afterEach(() => cleanup());

  it("surfaces a visible error state when the browser rejects the ops", () => {
    usePageSurface.mockReturnValue({
      available: true,
      rejected: ["malformed op list"],
    });

    render(<KeelCanvasSurface />);

    // The failure is rendered full-region, not swallowed to the console, and the
    // success surface container is NOT shown (no silent blank canvas).
    expect(screen.getByTestId("a2ui-surface-error")).toBeTruthy();
    expect(screen.getByText("malformed op list")).toBeTruthy();
    expect(screen.queryByTestId("a2ui-surface")).toBeNull();
  });

  it("renders the report surface when its ops apply", () => {
    render(<KeelCanvasSurface />);

    expect(screen.getByTestId("a2ui-surface")).toBeTruthy();
    expect(screen.getByTestId("generative-ui-rendered").textContent).toBe(
      "canvas:keel",
    );
    expect(screen.queryByTestId("a2ui-surface-error")).toBeNull();
    // The canvas hands the activity's ops to the page surface.
    expect(usePageSurface).toHaveBeenCalledWith(
      "canvas:keel",
      surfaceMessages[0].content.operations,
    );
  });

  it("clears the error panel when the surface disappears (surfaceId → null)", () => {
    usePageSurface.mockReturnValue({
      available: true,
      rejected: ["malformed op list"],
    });

    const { rerender } = render(<KeelCanvasSurface />);

    // The failed render leaves a visible error panel.
    expect(screen.getByTestId("a2ui-surface-error")).toBeTruthy();

    // A later surface activity arrives with empty operations, so surfaceId
    // resolves to null. The error panel must not outlive the surface it
    // describes.
    messagesRef.current = emptyMessages;
    rerender(<KeelCanvasSurface />);

    expect(screen.queryByTestId("a2ui-surface-error")).toBeNull();
    expect(screen.queryByTestId("a2ui-surface")).toBeNull();
  });
});
