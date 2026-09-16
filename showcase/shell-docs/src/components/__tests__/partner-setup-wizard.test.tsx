// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("preselects the route context and retains it while answering the first question", () => {
    mount();
    expect(new URLSearchParams(location.search).get("backend")).toBe("mastra");
    fireEvent.click(screen.getByRole("button", { name: /Existing project/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /Existing project/ }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Backend/ })).toBeNull();
    expect(screen.getByRole("button", { name: /3\s*Features/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
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
});
