// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "../setup-wizard";
import type { MapPick } from "@/lib/homepage-map";

vi.mock("posthog-js/react", () => ({ usePostHog: () => null }));

const frontends: MapPick[] = [
  { id: "react", name: "React", logo: { kind: "frontend", icon: "react" } },
];
const backends: MapPick[] = Array.from({ length: 18 }, (_, index) => ({
  id: `backend-${index}`,
  name: `Backend ${index}`,
  logo: { kind: "framework", slug: `backend-${index}` },
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.scrollBy = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});
afterEach(cleanup);

function mount(fixedBackend?: string) {
  return render(
    <SetupWizard
      frontends={frontends}
      backends={backends}
      capabilities={[]}
      fixedBackend={fixedBackend}
    />,
  );
}

function selectedSteps() {
  return Array.from(
    document.querySelectorAll(".wizard-rail-progress ol button"),
  ).map((button) => button.getAttribute("data-selected"));
}

// jsdom does not apply the CSS that hides the unused responsive controls.
function stepNavigation() {
  return within(screen.getByRole("navigation", { name: "Setup steps" }));
}

describe("setup wizard sidebar", () => {
  it("uses the sidebar by default and keeps one stage through the full flow", () => {
    mount();
    const stage = document.querySelector(".wizard-rail-stage");
    expect(stage).toBeTruthy();
    expect(document.querySelectorAll(".wizard-project-preview")).toHaveLength(
      2,
    );
    expect(
      screen.queryByRole("group", { name: "Preview wizard layouts" }),
    ).toBeNull();
    expect(selectedSteps()).toEqual([null, null, null, null, null]);
    expect(
      stepNavigation().getByRole<HTMLButtonElement>("button", {
        name: "Previous step",
      }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Existing project/ }));
    expect(screen.getByRole("heading", { name: "Your frontend" })).toBeTruthy();
    expect(document.querySelector(".wizard-rail-stage")).toBe(stage);
    expect(selectedSteps()).toEqual(["true", null, null, null, null]);
    expect(new URLSearchParams(location.search).get("project")).toBe("yes");
    expect(
      document
        .querySelector(".wizard-rail-progress-footer--desktop")
        ?.contains(
          stepNavigation().getByRole("button", { name: "Previous step" }),
        ),
    ).toBe(true);

    fireEvent.click(
      stepNavigation().getByRole("button", { name: "Previous step" }),
    );
    expect(
      screen.getByRole("heading", { name: "What are you building?" }),
    ).toBeTruthy();
    expect(
      document.querySelector('.wizard-rail-progress [aria-current="step"]')
        ?.textContent,
    ).toContain("Existing project");
    expect(
      document.querySelector('.wizard-step-choice[aria-pressed="true"] svg'),
    ).toBeTruthy();
    expect(document.querySelector(".wizard-step-choice-icon")).toBeNull();
    expect(
      document.querySelector(".wizard-project-preview-assistant-brand svg"),
    ).toBeTruthy();
    fireEvent.click(
      stepNavigation().getByRole("button", { name: "Next visited step" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(
      screen.getByRole("heading", { name: "Your agent backend" }),
    ).toBeTruthy();
    expect(document.querySelector(".wizard-rail-stage")).toBe(stage);
    expect(selectedSteps()).toEqual(["true", "true", null, null, null]);
    expect(screen.getAllByRole("button", { name: /Backend \d+/ })).toHaveLength(
      18,
    );
    expect(
      stepNavigation().getByRole<HTMLButtonElement>("button", {
        name: "Next visited step",
      }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Backend 17" }));
    fireEvent.click(
      stepNavigation().getByRole("button", { name: "Previous step" }),
    );
    expect(
      document.querySelector('.wizard-rail-progress [aria-current="step"]')
        ?.textContent,
    ).toContain("Backend 17");
    fireEvent.click(
      stepNavigation().getByRole("button", { name: "Next visited step" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(
      screen.getByRole("heading", { name: "Ready to set up" }),
    ).toBeTruthy();
    expect(selectedSteps()).toEqual(["true", "true", "true", null, null]);
    expect(new URLSearchParams(location.search).get("backend")).toBe(
      "backend-17",
    );
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("restores a saved project answer on the next step", () => {
    window.history.replaceState({}, "", "/?project=yes");
    mount();
    expect(document.querySelector(".wizard-rail-layout")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your frontend" })).toBeTruthy();
    const params = new URLSearchParams(location.search);
    expect(params.get("project")).toBe("yes");
  });

  it("animates the incoming question when motion is allowed", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    const animate = vi.fn().mockReturnValue({ cancel: vi.fn() });
    const originalAnimate = Element.prototype.animate;
    Element.prototype.animate = animate;
    try {
      mount();
      fireEvent.click(screen.getByRole("button", { name: /Existing project/ }));
      expect(animate).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "React" }));
      expect(animate).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.animate = originalAnimate;
    }
  });

  it("omits the fixed backend from partner progress", () => {
    window.history.replaceState({}, "", "/mastra");
    mount("backend-0");
    expect(selectedSteps()).toEqual([null, null, null, null]);
    expect(
      document.querySelector(".wizard-rail-progress")?.textContent,
    ).not.toContain("Backend");
    fireEvent.click(
      screen.getByRole("button", { name: /Existing project.*Add/ }),
    );
    expect(selectedSteps()).toEqual(["true", null, null, null]);
    fireEvent.click(screen.getByRole("button", { name: "React" }));
    expect(
      screen.getByRole("heading", { name: "What you want to build" }),
    ).toBeTruthy();
    fireEvent.click(
      stepNavigation().getByRole("button", { name: "Previous step" }),
    );
    expect(screen.getByRole("heading", { name: "Your frontend" })).toBeTruthy();
  });
});
