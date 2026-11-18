import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";

/** Clicks the copy button and lets its async click handler finish. */
async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

const showsCheck = (button: HTMLElement) =>
  button.querySelector(".lucide-check") !== null;

afterEach(() => vi.useRealTimers());

describe.each([
  ["user", CopilotChatUserMessage.CopyButton, "copilot-user-copy-button"],
  ["assistant", CopilotChatAssistantMessage.CopyButton, "copilot-copy-button"],
])("the %s copy button", (_name, CopyButton, testId) => {
  it("keeps the check mark for two seconds after the latest copy", async () => {
    vi.useFakeTimers();
    render(<CopyButton onClick={() => true} />);
    const button = screen.getByTestId(testId);

    await click(button);
    act(() => vi.advanceTimersByTime(1500));
    await click(button);
    act(() => vi.advanceTimersByTime(1500));
    expect(showsCheck(button)).toBe(true);
    act(() => vi.advanceTimersByTime(500));

    expect(showsCheck(button)).toBe(false);
  });

  it("shows no check mark when the copy fails", async () => {
    render(<CopyButton onClick={() => false} />);
    const button = screen.getByTestId(testId);

    await click(button);

    expect(showsCheck(button)).toBe(false);
  });
});
