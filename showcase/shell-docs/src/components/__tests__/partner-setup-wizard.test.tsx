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
      defaultBackend="mastra"
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
  it("honors explicit saved answers over page defaults", () => {
    window.history.replaceState({}, "", "/mastra?backend=langgraph-python");
    mount();
    expect(new URLSearchParams(location.search).get("backend")).toBe(
      "langgraph-python",
    );
  });
});
