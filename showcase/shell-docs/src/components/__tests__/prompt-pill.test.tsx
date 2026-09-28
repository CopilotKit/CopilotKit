// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PromptPill } from "../prompt-pill";
import { PROMPT_DESTINATION_HINT } from "../../lib/prompt-guidance";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A web page cannot choose the folder that a `claude-cli://` or `codex://`
// link opens the agent in, and the link does nothing without the app. About
// 90% of those clicks reached no agent (PE-337), so Copy is the only action
// (PE-381).
it("offers Copy and View prompt, and no app links or logos", () => {
  const { container } = render(
    <PromptPill createPrompt={() => ({ text: "Run" })} />,
  );
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Copy Prompt", "View prompt"]);
  expect(container.querySelector("img, a")).toBeNull();
});

it("views and copies the same prompt", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  let count = 0;
  render(<PromptPill createPrompt={() => ({ text: `Run ${++count}` })} />);
  fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Run 1",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Copy displayed prompt" }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("Run 1"));
  expect(screen.getByRole("button", { name: "Copy prompt" }).textContent).toBe(
    "Copy Prompt",
  );
});

it("copies the prompt from the main action", async () => {
  const action = vi.fn();
  const copied = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <PromptPill
      createPrompt={() => ({
        text: "Use this exact prompt",
        onAction: action,
        onCopied: copied,
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Prompt copied"),
  );
  expect(writeText).toHaveBeenCalledWith("Use this exact prompt");
  expect(action).toHaveBeenCalledExactlyOnceWith("copy");
  expect(copied).toHaveBeenCalledExactlyOnceWith("copy");
});

it("counts denied copy intent without claiming success and ignores analytics failure", async () => {
  const action = vi.fn(() => {
    throw new Error("analytics unavailable");
  });
  const copied = vi.fn();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(
    <PromptPill
      createPrompt={() => ({
        text: "Exact text",
        onAction: action,
        onCopied: copied,
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(action).toHaveBeenCalledExactlyOnceWith("copy");
  expect(copied).not.toHaveBeenCalled();
});

it("keeps preview actions bound to the displayed run and excludes close", async () => {
  const events: string[] = [];
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  let run = 0;
  render(
    <PromptPill
      createPrompt={() => {
        const id = ++run;
        return {
          text: `Run ${id}`,
          onAction: (action) => events.push(`${id}:${action}`),
          onCopied: (action) => events.push(`${id}:success:${action}`),
        };
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Copy displayed prompt" }),
  );
  await waitFor(() =>
    expect(events).toEqual([
      "1:view_prompt",
      "1:copy_preview",
      "1:success:copy_preview",
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close prompt" }));
  expect(events).toHaveLength(3);
});

it("reports a completed clipboard write after unmount without updating the UI", async () => {
  const copied = vi.fn();
  let resolveWrite!: () => void;
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      ),
    },
  });
  const { unmount } = render(
    <PromptPill
      createPrompt={() => ({ text: "Run once", onCopied: copied })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  unmount();
  resolveWrite();
  await waitFor(() => expect(copied).toHaveBeenCalledExactlyOnceWith("copy"));
});

// The line lives under each pill row, in the same place as under the docs
// hero, not in the hover shelf (PE-340).
it("keeps the destination line out of the pill itself", () => {
  render(<PromptPill createPrompt={() => ({ text: "Run" })} />);

  expect(screen.queryByText(PROMPT_DESTINATION_HINT)).toBeNull();
});
