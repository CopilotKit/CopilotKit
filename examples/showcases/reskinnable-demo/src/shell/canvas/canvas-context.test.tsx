import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasProvider, useCanvas } from "./canvas-context";

// The provider derives its surface from `agent.messages`; serve a mutable ref
// so each test can install its own stream before rendering.
const { messagesRef } = vi.hoisted(() => ({
  messagesRef: { current: [] as unknown[] },
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: { messages: messagesRef.current } }),
}));

const a2uiSurface = (surfaceId: string, id: string) => ({
  id,
  role: "activity",
  activityType: "a2ui-surface",
  content: { a2ui_operations: [{ createSurface: { surfaceId } }] },
});

function Probe() {
  const { activeSurfaceKind, activeSurfaceId } = useCanvas();
  return (
    <div>
      <span data-testid="kind">{activeSurfaceKind ?? "none"}</span>
      <span data-testid="id">{activeSurfaceId ?? "none"}</span>
    </div>
  );
}

function renderWith(messages: unknown[]) {
  messagesRef.current = messages;
  render(
    <CanvasProvider>
      <Probe />
    </CanvasProvider>,
  );
  return {
    kind: screen.getByTestId("kind").textContent,
    id: screen.getByTestId("id").textContent,
  };
}

afterEach(() => {
  cleanup();
  messagesRef.current = [];
});

describe("useLatestCanvasSurface (via CanvasProvider)", () => {
  it("claims a report surface for the canvas", () => {
    expect(renderWith([a2uiSurface("keel-ops-report-x1", "m1")])).toEqual({
      kind: "report",
      id: "m1",
    });
  });

  it("claims an OGUI surface for the canvas", () => {
    expect(
      renderWith([
        { id: "m1", role: "activity", activityType: "open-generative-ui" },
      ]),
    ).toEqual({ kind: "ogui", id: "m1" });
  });

  it("does NOT claim an inline block: surface (it renders in the transcript)", () => {
    expect(renderWith([a2uiSurface("block:kpis", "m1")])).toEqual({
      kind: "none",
      id: "none",
    });
  });

  it("keeps an earlier report surface when a later block: surface arrives", () => {
    expect(
      renderWith([
        a2uiSurface("keel-ops-report-x1", "m1"),
        a2uiSurface("block:kpis", "m2"),
      ]),
    ).toEqual({ kind: "report", id: "m1" });
  });
});
