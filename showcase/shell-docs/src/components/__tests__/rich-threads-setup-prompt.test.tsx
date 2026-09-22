// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  RICH_THREADS_SETUP_PROMPT,
  RichThreadsSetupPrompt,
} from "../rich-threads-setup-prompt";

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

test("copies the Threads prompt using the standard actions", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<RichThreadsSetupPrompt />);
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(
      writeText.mock.calls[0]?.[0]?.replace(/ --run [a-f0-9]{12}/, ""),
    ).toBe(RICH_THREADS_SETUP_PROMPT),
  );
  expect(screen.getByRole("status").textContent).toBe("Prompt copied");
  expect(
    screen.getByRole("button", { name: "Open in Claude Code" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open in Codex" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "More page actions" }),
  ).toBeTruthy();
});

test("previews the exact setup prompt and recovers from blocked clipboard access", async () => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<RichThreadsSetupPrompt />);
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  expect(
    (screen.getByRole("textbox") as HTMLTextAreaElement).value.replace(
      / --run [a-f0-9]{12}/,
      "",
    ),
  ).toBe(RICH_THREADS_SETUP_PROMPT);
  expect(screen.getByRole("status").textContent).toContain("Copy blocked");
});

test("sends the coding agent to the Threads route and carries nothing else", () => {
  // The route owns the guide links, the identity rules, the ownership checks
  // and the Inspector proof this prompt used to repeat. A copy of them here
  // drifts the next time the Runtime API changes, which is what OSS-1150
  // retired.
  expect(RICH_THREADS_SETUP_PROMPT).toContain(
    "npx --yes copilotkit@latest onboard start --intent add-rich-threads",
  );
  expect(RICH_THREADS_SETUP_PROMPT).not.toContain("docs.copilotkit.ai");
  expect(RICH_THREADS_SETUP_PROMPT).not.toContain("identifyUser");
  expect(RICH_THREADS_SETUP_PROMPT).not.toContain(
    "Never use a fixed demo identity in production",
  );
  // No run id: this string is static and llm-text inlines it into cached raw
  // Markdown, so one minted here would be shared by every reader.
  expect(RICH_THREADS_SETUP_PROMPT).not.toContain("--run");
});

vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));

test("keeps credential protection without the diagnostic feedback restriction", () => {
  expect(RICH_THREADS_SETUP_PROMPT).toContain("Never reveal credentials.");
  expect(RICH_THREADS_SETUP_PROMPT).not.toContain("diagnostic");
});
