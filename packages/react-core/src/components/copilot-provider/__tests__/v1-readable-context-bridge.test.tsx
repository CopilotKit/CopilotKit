import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKit } from "../copilotkit";
import { useCopilotContext } from "../../../context/copilot-context";
import { useCopilotReadable } from "../../../hooks/use-copilot-readable";

/**
 * Writer: registers context through useCopilotReadable, which writes into the
 * v2 context store (via the v2 provider the v1 <CopilotKit> wraps internally).
 */
function ReadableWriter() {
  useCopilotReadable({
    description: "The user's name",
    value: "Ada Lovelace",
  });
  return null;
}

/**
 * Reader: reads through the v1 context surface on demand — exactly what
 * CopilotTask, the dev-console and CopilotTextarea autosuggestions do.
 */
function ContextReader() {
  const { getContextString } = useCopilotContext();
  const [result, setResult] = React.useState("");
  return (
    <>
      <button data-testid="read" onClick={() => setResult(getContextString([], []))}>
        read
      </button>
      <div data-testid="contextString">{result}</div>
    </>
  );
}

/**
 * Regression coverage for #6408: useCopilotReadable was repointed onto the
 * v2 context store, but the v1 <CopilotKit> bridge's getContextString kept
 * reading the v1 context tree — which has no writers anymore — so CopilotTask
 * and CopilotTextarea autosuggestions shipped an empty ("\n\n") context.
 */
describe("v1 <CopilotKit> bridge → readable context", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("exposes useCopilotReadable entries through getContextString", () => {
    render(
      <CopilotKit publicApiKey="test-key">
        <ReadableWriter />
        <ContextReader />
      </CopilotKit>,
    );

    act(() => {
      screen.getByTestId("read").click();
    });

    const contextString = screen.getByTestId("contextString").textContent;
    expect(contextString).toContain("The user's name:");
    expect(contextString).toContain('"Ada Lovelace"');
  });

  it("clears the context string after the readable unmounts", () => {
    function Toggle() {
      const [mounted, setMounted] = React.useState(true);
      return (
        <>
          <button data-testid="toggle" onClick={() => setMounted(!mounted)}>
            toggle
          </button>
          {mounted ? <ReadableWriter /> : null}
          <ContextReader />
        </>
      );
    }

    render(
      <CopilotKit publicApiKey="test-key">
        <Toggle />
      </CopilotKit>,
    );

    act(() => {
      screen.getByTestId("read").click();
    });
    expect(screen.getByTestId("contextString").textContent).toContain(
      "The user's name:",
    );

    act(() => {
      screen.getByTestId("toggle").click();
    });
    act(() => {
      screen.getByTestId("read").click();
    });

    expect(screen.getByTestId("contextString").textContent).toBe("\n\n");
  });
});