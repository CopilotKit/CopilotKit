// @vitest-environment jsdom
//
// The wizard writes the clipboard from a single control, so its copy event
// must say so. Without `action` the event lands in the same stream as the
// deep-link opens emitted by <PromptPill>, and a reader counting
// `docs.intelligence_onboarding_prompt_copied` cannot tell a deliberate copy
// from an app handoff. See PE-218.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "../setup-wizard";
import { INTELLIGENCE_ONBOARDING_EVENTS } from "@/lib/intelligence-onboarding-prompt";
import type { MapPick } from "@/lib/homepage-map";

const capture = vi.fn();
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture }) }));

const frontends: MapPick[] = [
  { id: "react", name: "React", logo: { kind: "frontend", icon: "react" } },
];
const backends: MapPick[] = [
  { id: "mastra", name: "mastra", logo: { kind: "framework", slug: "mastra" } },
];

/** Drives the wizard to its copy control and returns the captured properties. */
async function copyFromWizard(
  pathname: string,
): Promise<Record<string, unknown>> {
  window.history.replaceState(
    {},
    "",
    `${pathname}?agent=no&project=yes&frontend=react`,
  );
  render(
    <SetupWizard
      frontends={frontends}
      backends={backends}
      capabilities={[]}
      fixedBackend="mastra"
      defaultFrontend="react"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(
      capture.mock.calls.find(
        ([event]) => event === INTELLIGENCE_ONBOARDING_EVENTS.promptCopied,
      ),
    ).toBeDefined(),
  );
  const call = capture.mock.calls.find(
    ([event]) => event === INTELLIGENCE_ONBOARDING_EVENTS.promptCopied,
  );
  return call![1] as Record<string, unknown>;
}

beforeEach(() => {
  capture.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(cleanup);

describe("setup wizard copy telemetry", () => {
  it("records the clipboard write as a deliberate copy", async () => {
    const properties = await copyFromWizard("/mastra");
    expect(properties.action).toBe("copy");
  });

  it("names the surface and page so the copy can be segmented", async () => {
    const properties = await copyFromWizard("/langgraph-python");
    expect(properties.surface).toBe("docs_setup_wizard");
    expect(properties.from_path).toBe("/langgraph-python");
  });
});
