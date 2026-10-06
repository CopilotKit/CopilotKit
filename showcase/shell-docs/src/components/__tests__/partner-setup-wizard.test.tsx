// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "../setup-wizard";
import type { MapPick } from "@/lib/homepage-map";
vi.mock("posthog-js/react", () => ({ usePostHog: () => null }));
const frontends: MapPick[] = [
  { id: "react", name: "React", logo: { kind: "frontend", icon: "react" } },
];
const backends: MapPick[] = ["mastra", "langgraph-python"].map((id) => ({
  id,
  name: id,
  logo: { kind: "framework", slug: id },
}));
beforeEach(() => {
  window.history.replaceState({}, "", "/mastra");
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(cleanup);
const mount = () =>
  render(
    <SetupWizard
      frontends={frontends}
      backends={backends}
      capabilities={[]}
      fixedBackend="mastra"
      defaultFrontend="react"
    />,
  );
describe("partner setup context", () => {
  it.each([
    ["Existing project.*Add", "yes", "no"],
    ["Existing agent", "yes", "yes"],
    ["New project", "no", "no"],
  ])("sets project and agent context for %s", (label, project, agent) => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    const params = new URLSearchParams(location.search);
    expect(params.get("project")).toBe(project);
    expect(params.get("agent")).toBe(agent);
    expect(screen.getByRole("heading", { name: "Your frontend" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^New agent/ })).toBeNull();
  });

  it("preselects the route context and retains it while answering the first question", () => {
    mount();
    expect(new URLSearchParams(location.search).get("backend")).toBe("mastra");
    fireEvent.click(screen.getByRole("button", { name: /Existing agent/ }));
    expect(new URLSearchParams(location.search).get("agent")).toBe("yes");
    expect(new URLSearchParams(location.search).get("backend")).toBe("mastra");
    expect(new URLSearchParams(location.search).get("project")).toBe("yes");
  });
  it("keeps the page partner even when a saved URL names another backend", () => {
    window.history.replaceState({}, "", "/mastra?backend=langgraph-python");
    mount();
    expect(new URLSearchParams(location.search).get("backend")).toBe("mastra");
  });
  it("skips the backend in both directions and keeps it in the review", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Existing agent/ }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Backend/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Features" })).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Setup steps" })).getByRole(
        "button",
        { name: "Previous step" },
      ),
    );
    expect(screen.getByRole("heading", { name: "Your frontend" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).toBeTruthy();
    expect(screen.getByText("mastra", { exact: true })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Change agent backend" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Set up manually" })
        .getAttribute("href"),
    ).toBe("/mastra/quickstart");
  });
  it("still asks for the backend on the main landing page", () => {
    render(
      <SetupWizard
        frontends={frontends}
        backends={backends}
        capabilities={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Existing project/ }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).toBeTruthy();
  });
  it.each(["yes", "no"] as const)(
    "copies the %s agent starting point separately from the app",
    async (agent) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      window.history.replaceState(
        {},
        "",
        `/mastra?agent=${agent}&project=yes&frontend=react`,
      );
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      expect(writeText.mock.calls[0][0]).toContain(
        agent === "yes"
          ? "Connect that existing agent without replacing it"
          : "Create it as part of the setup",
      );
      expect(writeText.mock.calls[0][0]).toContain("existing project");
      expect(
        screen.queryByRole("button", { name: "Change agent backend" }),
      ).toBeNull();
    },
  );
  it("does not mistake an old project answer for an agent answer", () => {
    window.history.replaceState({}, "", "/mastra?project=yes&frontend=react");
    mount();
    expect(
      screen.getByRole("heading", {
        name: "What are you building?",
      }),
    ).toBeTruthy();
  });
  it("normalizes an impossible existing-agent new-project URL", () => {
    window.history.replaceState(
      {},
      "",
      "/mastra?agent=yes&project=no&frontend=react",
    );
    mount();
    expect(new URLSearchParams(location.search).get("agent")).toBe("no");
  });
});
