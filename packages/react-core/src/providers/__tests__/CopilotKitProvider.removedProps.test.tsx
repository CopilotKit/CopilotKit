import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";

/** The removal warnings among the calls of a `console.warn` spy. */
function removalWarnings(warn: { mock: { calls: unknown[][] } }) {
  return warn.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        typeof message === "string" &&
        message.includes("was removed in CopilotKit 2.0."),
    );
}

// Core tests which props throw and which warn (ɵcheckRemovedProviderProps).
// These tests pin that the provider checks the props that it gets.
describe("CopilotKitProvider with the props of the 1.x <CopilotKit>", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws the removal error for a prop that cannot work in 2.0", () => {
    // React logs the error of a render before it throws the error.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      render(
        <CopilotKitProvider
          // @ts-expect-error -- 2.0 types the 1.x prop as never
          threadId="thread-1"
        >
          <p>chat</p>
        </CopilotKitProvider>,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "REMOVED_API",
        message: expect.stringContaining(
          'The "threadId" prop of CopilotKit was removed in CopilotKit 2.0.',
        ),
      }),
    );
  });

  it("renders, and warns once, for a prop that 2.0 ignores", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = (
      <CopilotKitProvider
        // @ts-expect-error -- 2.0 types the 1.x prop as never
        textToSpeechUrl="/api/tts"
      >
        <p>chat</p>
      </CopilotKitProvider>
    );

    const { rerender } = render(app);
    rerender(app);

    expect(screen.getByText("chat").textContent).toBe("chat");
    expect(removalWarnings(warn)).toEqual([
      'The "textToSpeechUrl" prop of CopilotKit was removed in CopilotKit 2.0. Delete it. Voice input goes through the transcription service of the runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#provider-props',
    ]);
  });

  it("renders the props of 2.0 without a removal warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <CopilotKitProvider
        headers={{ Authorization: "Bearer token" }}
        properties={{ userId: "user-1" }}
      >
        <p>chat</p>
      </CopilotKitProvider>,
    );

    expect(screen.getByText("chat").textContent).toBe("chat");
    expect(removalWarnings(warn)).toEqual([]);
  });
});
