// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PromptPill } from "../prompt-pill";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

// The pill renders View prompt twice, and CSS shows one: the shelf button for a
// pointer that can hover, and the eye in the pill for touch. jsdom applies no
// media queries, so tests name the one they mean.
const viewShelf = () =>
  within(document.querySelector(".prompt-pill-shelf") as HTMLElement).getByRole(
    "button",
    { name: "View prompt" },
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A touch screen cannot hover to reveal the shelf, so View prompt is also an
// eye inside the pill, right of Copy (PE-381). CSS picks one from the first
// paint, so the page never shows the wrong control while it hydrates.
it("offers the eye inside the pill, which opens the same preview", () => {
  render(<PromptPill createPrompt={() => ({ text: "Run" })} />);
  const dock = screen.getByRole("group", { name: "Agent prompt" });
  expect(
    Array.from(dock.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Copy prompt", "View prompt"]);
  fireEvent.click(within(dock).getByRole("button", { name: "View prompt" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Run",
  );
});

it("views and copies the same prompt", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  let count = 0;
  render(<PromptPill createPrompt={() => ({ text: `Run ${++count}` })} />);
  fireEvent.click(viewShelf());
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
