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
import * as launcher from "../../lib/launch-prompt";

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

it("launches a full native prompt before a denied clipboard settles", async () => {
  const launch = vi
    .spyOn(launcher, "launchPrompt")
    .mockImplementation(() => {});
  const copied = vi.fn();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(
    <PromptPill
      createPrompt={() => ({
        text: "Set up & inspect ü\nnext",
        onCopied: copied,
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open in Codex" }));
  expect(launch).toHaveBeenCalledWith("codex", "Set up & inspect ü\nnext");
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(screen.getByRole("textbox").getAttribute("readonly")).not.toBeNull();
  expect(copied).not.toHaveBeenCalled();
});

it("views and copies the same prompt without launching an app", async () => {
  const launch = vi
    .spyOn(launcher, "launchPrompt")
    .mockImplementation(() => {});
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
  expect(launch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Copy prompt" }).textContent).toBe(
    "COPY PROMPT",
  );
});

it("keeps long Claude prompts available without issuing an invalid app link", () => {
  const launch = vi
    .spyOn(launcher, "launchPrompt")
    .mockImplementation(() => {});
  render(<PromptPill createPrompt={() => ({ text: "x".repeat(5001) })} />);
  fireEvent.click(screen.getByRole("button", { name: "Open in Claude Code" }));
  expect(launch).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("textbox") as HTMLTextAreaElement).value.length,
  ).toBe(5001);
});

it("does not launch an app for the main copy action", async () => {
  const launch = vi
    .spyOn(launcher, "launchPrompt")
    .mockImplementation(() => {});
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <PromptPill createPrompt={() => ({ text: "Use this exact prompt" })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Prompt copied"),
  );
  expect(writeText).toHaveBeenCalledWith("Use this exact prompt");
  expect(launch).not.toHaveBeenCalled();
});

it("launches the in-flight payload when another app is clicked before copy resolves", async () => {
  const launch = vi
    .spyOn(launcher, "launchPrompt")
    .mockImplementation(() => {});
  let resolveWrite!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
  );
  Object.assign(navigator, { clipboard: { writeText } });
  let run = 0;
  render(<PromptPill createPrompt={() => ({ text: `Run ${++run}` })} />);
  fireEvent.click(screen.getByRole("button", { name: "Open in Claude Code" }));
  fireEvent.click(screen.getByRole("button", { name: "Open in Codex" }));
  expect(launch.mock.calls).toEqual([
    ["claude", "Run 1"],
    ["codex", "Run 1"],
  ]);
  expect(writeText).toHaveBeenCalledTimes(1);
  resolveWrite();
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Prompt copied"),
  );
});
