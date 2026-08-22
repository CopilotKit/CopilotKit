import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThreadRestoreError } from "@copilotkit/core";
import { CopilotChatRestoreView } from "../CopilotChatRestoreView";

describe("CopilotChatRestoreView", () => {
  it("renders an accessible restoring status", () => {
    render(
      <CopilotChatRestoreView
        threadRestore={{
          status: "restoring",
          threadId: "thread-1",
          restoreAttemptId: "restore-1",
          elapsedMs: 5_000,
          reloadConversation: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Restoring conversation…",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders exact failure copy, support ID, and collapses duplicate reloads", async () => {
    let resolveReload!: () => void;
    const reloadConversation = vi.fn(
      () => new Promise<void>((resolve) => (resolveReload = resolve)),
    );
    const error = new ThreadRestoreError({
      restoreAttemptId: "restore-support-123",
      code: "timeout",
      retryable: true,
      retryAction: "reload_conversation",
    });

    render(
      <CopilotChatRestoreView
        threadRestore={{
          status: "failed",
          threadId: "thread-1",
          restoreAttemptId: error.restoreAttemptId,
          error,
          reloadConversation,
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "This conversation couldn’t be restored.",
    );
    expect(screen.getByText("Support ID: restore-support-123")).not.toBeNull();

    const button = screen.getByRole("button", {
      name: "Reload conversation",
    });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(reloadConversation).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveReload());
  });
});
