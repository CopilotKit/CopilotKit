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
import { LearningSetupPrompt } from "../learning-setup-prompt";
import { RichThreadsSetupPrompt } from "../rich-threads-setup-prompt";
import { MemorySetupPrompt } from "../memory-setup-prompt";
import { WebMCPSetupPrompt } from "../webmcp-setup-prompt";
import { IntelligenceOnboardingPrompt } from "../intelligence-onboarding-prompt";
import { ChannelsStartPrompt } from "../channels-start-prompt";
import { DocsPromptActionsProvider } from "../docs-prompt-actions";
import { launchPrompt } from "@/lib/launch-prompt";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => analytics }));
vi.mock("next/navigation", () => ({ usePathname: () => "/mastra/learning" }));
vi.mock("fumadocs-core/framework", () => ({
  usePathname: () => "/mastra/learning",
}));
vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ baseUrl: "https://docs.copilotkit.ai" }),
}));
vi.mock("@/lib/launch-prompt", () => ({ launchPrompt: vi.fn() }));
const actionEvent = "docs.intelligence_onboarding_prompt_action_clicked";
const copiedEvent = "docs.intelligence_onboarding_prompt_copied";
function events(name: string) {
  return analytics.capture.mock.calls
    .filter(([event]) => event === name)
    .map(([, properties]) => properties);
}
beforeEach(() => {
  vi.clearAllMocks();
  analytics.capture.mockImplementation(() => undefined);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);

test.each([
  [LearningSetupPrompt, "add-learning", "docs_learning_setup_prompt"],
  [
    RichThreadsSetupPrompt,
    "add-rich-threads",
    "docs_rich_threads_setup_agent_prompt",
  ],
] as const)(
  "CLI-backed setup joins each successful copy to its own run (%s)",
  async (Component, intent, surface) => {
    render(
      <DocsPromptActionsProvider
        value={{
          markdownUrl: "/mastra/learning.mdx",
          githubUrl: "https://github.com/example",
          agentFramework: "mastra",
          frontend: "react",
        }}
      >
        <Component />
      </DocsPromptActionsProvider>,
    );
    for (let count = 1; count <= 2; count++) {
      fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
      await waitFor(() => expect(events(copiedEvent)).toHaveLength(count));
      const event = events(copiedEvent)[count - 1];
      expect(event).toMatchObject({
        action: "copy",
        surface,
        from_path: "/mastra/learning",
        agent_framework: "mastra",
        frontend: "react",
        onboarding_intent: intent,
      });
      expect(event.onboarding_run_id).toMatch(/^[a-f0-9]{12}$/);
      expect(
        vi.mocked(navigator.clipboard.writeText).mock.calls[count - 1][0],
      ).toContain(
        `/onboarding-prompts/${event.onboarding_run_id}?intent=${intent}`,
      );
      expect(events(actionEvent)[count - 1]).toEqual(event);
    }
    expect(events(copiedEvent)[0].onboarding_run_id).not.toBe(
      events(copiedEvent)[1].onboarding_run_id,
    );
  },
);

test("preview, rejected copy and retry retain the same run without false success", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
    new Error("denied"),
  );
  render(<LearningSetupPrompt />);
  fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
  const displayed = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
  const attempt = events(actionEvent)[0];
  expect(attempt.action).toBe("view_prompt");
  expect(events(copiedEvent)).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Copy displayed prompt" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Copy blocked"),
  );
  expect(events(copiedEvent)).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Copy displayed prompt" }),
  );
  await waitFor(() => expect(events(copiedEvent)).toHaveLength(1));
  expect(events(copiedEvent)[0]).toMatchObject({
    action: "copy_preview",
    onboarding_run_id: attempt.onboarding_run_id,
  });
  expect(
    vi.mocked(navigator.clipboard.writeText).mock.calls.map(([text]) => text),
  ).toEqual([displayed, displayed]);
});

test.each([MemorySetupPrompt, WebMCPSetupPrompt])(
  "guide-only setup tracks actions without inventing a CLI run (%s)",
  async (Component) => {
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(events(copiedEvent)).toHaveLength(1));
    expect(events(actionEvent)[0]).toMatchObject({
      action: "copy",
      from_path: "/mastra/learning",
    });
    expect(events(copiedEvent)[0].onboarding_run_id).toBeUndefined();
    expect(events(copiedEvent)[0].onboarding_intent).toBeUndefined();
    expect(
      vi.mocked(navigator.clipboard.writeText).mock.calls[0][0],
    ).not.toContain("--run");
  },
);

test.each([
  ["learning", <LearningSetupPrompt key="learning" />, copiedEvent],
  [
    "intelligence",
    <IntelligenceOnboardingPrompt
      key="intelligence"
      feature="threads"
      surface="docs_test"
    />,
    copiedEvent,
  ],
  [
    "channels",
    <ChannelsStartPrompt key="channels" frontend="slack" />,
    "docs.channels_activation_prompt_copied",
  ],
] as const)(
  "%s distinguishes both app launches from copy actions",
  async (_name, component, successEvent) => {
    render(component);
    for (const [label, action, app] of [
      ["Open in Claude Code", "open_claude", "claude"],
      ["Open in Codex", "open_codex", "codex"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() =>
        expect(events(successEvent).at(-1)?.action).toBe(action),
      );
      const clicked = events(actionEvent).at(-1);
      expect(clicked?.action).toBe(action);
      expect(events(successEvent).at(-1)).toEqual(clicked);
      const text = vi
        .mocked(navigator.clipboard.writeText)
        .mock.calls.at(-1)?.[0];
      expect(launchPrompt).toHaveBeenLastCalledWith(app, text);
      expect(text).toContain(clicked?.onboarding_run_id);
    }
    expect(events(actionEvent)).toHaveLength(2);
    expect(events(successEvent)).toHaveLength(2);
  },
);

test("analytics exceptions cannot prevent setup copying", async () => {
  analytics.capture.mockImplementation(() => {
    throw new Error("unavailable");
  });
  render(<MemorySetupPrompt />);
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Prompt copied"),
  );
  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
});
