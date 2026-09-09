import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable stubs for the a2ui runtime actions the canvas drives.
const { processMessages, getSurface, messagesRef } = vi.hoisted(() => ({
  processMessages: vi.fn(),
  getSurface: vi.fn(() => undefined as unknown),
  // Mutable so a test can swap the agent's message stream between renders.
  messagesRef: { current: [] as unknown[] },
}));

// One a2ui-surface activity whose op list carries a createSurface (so a
// surfaceId resolves) — the healthy case.
const surfaceMessages = [
  {
    role: "activity",
    activityType: "a2ui-surface",
    content: {
      a2ui_operations: [{ createSurface: { surfaceId: "keel-ops-report" } }],
    },
  },
];

// A later a2ui-surface activity with an empty op list — surfaceId resolves to
// null, so SurfaceMessageProcessor unmounts.
const emptyMessages = [
  {
    role: "activity",
    activityType: "a2ui-surface",
    content: { a2ui_operations: [] },
  },
];

// The canvas reads its surface out of `agent.messages`; serve the mutable ref
// so a test can advance the stream.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: { messages: messagesRef.current } }),
}));

vi.mock("@copilotkit/a2ui-renderer", () => ({
  A2UIProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  A2UIRenderer: ({ surfaceId }: { surfaceId: string | null }) => (
    <div data-testid="a2ui-rendered">{surfaceId}</div>
  ),
  createCatalog: () => ({}),
  useA2UIActions: () => ({ processMessages, getSurface }),
}));

// The catalog's KPI/chart/table renderers bind live desk data. `A2UIRenderer` is
// stubbed above, so none of them actually mounts here — but the stub keeps this
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
    processMessages.mockReset();
    getSurface.mockReset();
    getSurface.mockReturnValue(undefined);
    messagesRef.current = surfaceMessages;
  });
  afterEach(() => cleanup());

  it("surfaces a visible error state when processMessages throws", () => {
    processMessages.mockImplementation(() => {
      throw new Error("malformed op list");
    });

    render(<KeelCanvasSurface />);

    // The failure is rendered full-region, not swallowed to the console, and the
    // success surface container is NOT shown (no silent blank canvas).
    expect(screen.getByTestId("a2ui-surface-error")).toBeTruthy();
    expect(screen.getByText("malformed op list")).toBeTruthy();
    expect(screen.queryByTestId("a2ui-surface")).toBeNull();
  });

  it("renders the report surface when processMessages succeeds", () => {
    processMessages.mockImplementation(() => undefined);

    render(<KeelCanvasSurface />);

    expect(screen.getByTestId("a2ui-surface")).toBeTruthy();
    expect(screen.queryByTestId("a2ui-surface-error")).toBeNull();
  });

  it("clears the error panel when the surface disappears (surfaceId → null)", () => {
    processMessages.mockImplementation(() => {
      throw new Error("malformed op list");
    });

    const { rerender } = render(<KeelCanvasSurface />);

    // The failed render leaves a visible error panel.
    expect(screen.getByTestId("a2ui-surface-error")).toBeTruthy();

    // A later a2ui-surface activity arrives with empty operations, so surfaceId
    // resolves to null and SurfaceMessageProcessor unmounts. The error panel
    // must not outlive the surface it describes.
    messagesRef.current = emptyMessages;
    rerender(<KeelCanvasSurface />);

    expect(screen.queryByTestId("a2ui-surface-error")).toBeNull();
    expect(screen.queryByTestId("a2ui-surface")).toBeNull();
  });
});
