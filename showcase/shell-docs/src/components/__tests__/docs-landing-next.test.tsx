// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocsLandingNext } from "../docs-landing-next";
import { frontendPicks, visibleIntegrations } from "@/lib/homepage-map";
import { landingIntegrations } from "@/lib/landing-integrations";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
});
afterEach(cleanup);

function directory() {
  render(<DocsLandingNext />);
  return screen.getByRole("region", {
    name: "Fits the stack you already have.",
  });
}

describe("DocsLandingNext", () => {
  it("keeps every visible integration destination exactly once in the grouped directory", () => {
    const groups = landingIntegrations();
    const destinations = groups.flatMap((group) =>
      group.choices.map((choice) => choice.slug),
    );
    expect(destinations.sort()).toEqual(
      visibleIntegrations()
        .map((integration) => integration.slug)
        .sort(),
    );
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it("shows all groups in priority order without an expand control", () => {
    const root = directory();
    const groups = landingIntegrations();
    expect(groups.slice(0, 7).map((group) => group.name)).toEqual([
      "CopilotKit",
      "DeepAgents",
      "LangChain",
      "Google ADK",
      "AWS Strands",
      "Microsoft Agent Framework",
      "Mastra",
    ]);
    expect(
      [...root.querySelectorAll('a, button[aria-haspopup="dialog"]')].map(
        (el) => el.textContent,
      ),
    ).toEqual(groups.map((group) => group.name));
    expect(root.querySelector("details")).toBeNull();
  });

  it.each(frontendPicks())(
    "routes the full directory using the selected $name frontend",
    (frontend) => {
      directory();
      fireEvent.click(screen.getByRole("radio", { name: frontend.name }));
      expect(
        (
          screen.getByRole("radio", {
            name: frontend.name,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
      expect(
        screen.getByRole("link", { name: "CopilotKit" }).getAttribute("href"),
      ).toBe(frontend.id === "react" ? "/quickstart" : `/${frontend.id}`);
      expect(
        screen.getByRole("link", { name: "DeepAgents" }).getAttribute("href"),
      ).toBe(
        frontend.id === "react" ? "/deepagents" : `/${frontend.id}/deepagents`,
      );
      fireEvent.click(screen.getByRole("button", { name: "AWS Strands" }));
      const dialog = screen.getByRole("dialog", { name: "AWS Strands" });
      expect(dialog.textContent).toContain(`continue with ${frontend.name}`);
      expect(
        within(dialog)
          .getByRole("link", { name: "TypeScript" })
          .getAttribute("href"),
      ).toBe(
        frontend.id === "react"
          ? "/strands-typescript"
          : `/${frontend.id}/strands-typescript`,
      );
    },
  );

  it("opens LangChain languages and retains the Python FastAPI route", () => {
    directory();
    fireEvent.click(screen.getByRole("button", { name: "LangChain" }));
    const dialog = screen.getByRole("dialog", { name: "LangChain" });
    expect(
      within(dialog).getByRole("link", { name: "Python" }).getAttribute("href"),
    ).toBe("/langgraph-python");
    expect(
      within(dialog)
        .getByRole("link", { name: "TypeScript" })
        .getAttribute("href"),
    ).toBe("/langgraph-typescript");
    expect(
      within(dialog)
        .getByRole("link", { name: "Python with FastAPI" })
        .getAttribute("href"),
    ).toBe("/langgraph-fastapi");
  });

  it("offers Microsoft's actual Python and .NET integrations", () => {
    directory();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Microsoft Agent Framework",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Microsoft Agent Framework",
    });
    expect(
      within(dialog).getByRole("link", { name: "Python" }).getAttribute("href"),
    ).toBe("/ms-agent-python");
    expect(
      within(dialog).getByRole("link", { name: ".NET" }).getAttribute("href"),
    ).toBe("/ms-agent-dotnet");
    expect(
      within(dialog).queryByRole("link", { name: "TypeScript" }),
    ).toBeNull();
  });

  it("closes the dialog and can open a different framework", () => {
    directory();
    fireEvent.click(screen.getByRole("button", { name: "LangChain" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Close language selector" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AWS Strands" }));
    expect(screen.getByRole("dialog", { name: "AWS Strands" })).not.toBeNull();
  });
});
