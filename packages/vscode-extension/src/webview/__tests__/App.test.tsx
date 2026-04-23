import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import React from "react";

// Must import setup before App to mock acquireVsCodeApi
import { simulateExtensionMessage, postMessageMock } from "./setup";

// Mock @copilotkit/a2ui-renderer
vi.mock("@copilotkit/a2ui-renderer", () => ({
  A2UIProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="a2ui-provider">{children}</div>
  ),
  A2UIRenderer: ({ surfaceId }: { surfaceId: string }) => (
    <div data-testid="a2ui-renderer">Surface: {surfaceId}</div>
  ),
  basicCatalog: {},
  useA2UIActions: () => ({
    processMessages: vi.fn(),
  }),
}));

// Import App after mocks
const { App } = await import("../App");

describe("App", () => {
  beforeEach(() => {
    postMessageMock.mockClear();
  });

  it("shows waiting message when no fixtures are loaded", () => {
    render(<App />);
    expect(screen.getByText("Waiting for component data...")).toBeDefined();
  });

  it("sends ready message on mount", () => {
    render(<App />);
    expect(postMessageMock).toHaveBeenCalledWith({ type: "ready" });
  });

  it("shows waiting state when fixtures arrive but catalog is not yet loaded", async () => {
    render(<App />);

    act(() => {
      simulateExtensionMessage({
        type: "fixture-update",
        fixtures: {
          default: { surfaceId: "preview", messages: [] },
        },
      });
    });

    // Should still show waiting message because catalogVersion is 0
    await waitFor(() => {
      expect(screen.getByText("Waiting for component data...")).toBeDefined();
    });
  });

  it("shows error overlay on error message", async () => {
    render(<App />);

    act(() => {
      simulateExtensionMessage({
        type: "error",
        message: "Bundle failed: syntax error",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Bundle failed: syntax error")).toBeDefined();
    });
  });

  it("shows fixture picker when multiple fixtures exist", async () => {
    render(<App />);

    act(() => {
      simulateExtensionMessage({
        type: "fixture-update",
        fixtures: {
          default: { surfaceId: "preview", messages: [] },
          "empty state": { surfaceId: "preview", messages: [] },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeDefined();
    });
  });
});
