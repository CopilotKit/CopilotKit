// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocsLandingNext } from "../docs-landing-next";
import { frontendPicks, visibleIntegrations } from "@/lib/homepage-map";

function renderDirectory() {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<DocsLandingNext />);
  return root;
}

describe("DocsLandingNext", () => {
  it("links every visible integration exactly once, including those in the full directory", () => {
    const root = renderDirectory();
    for (const integration of visibleIntegrations()) {
      const links = [...root.querySelectorAll("a")].filter(
        (link) => link.textContent === integration.name,
      );
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toBe(
        integration.slug === "built-in-agent"
          ? "/quickstart"
          : `/${integration.slug}`,
      );
    }
  });

  it("starts with six integration choices and lets readers expand the rest", () => {
    const root = renderDirectory();
    const directory = root.querySelector("details")!;
    expect(directory.hasAttribute("open")).toBe(false);
    expect(directory.querySelectorAll("a")).toHaveLength(
      visibleIntegrations().length - 6,
    );
    expect(directory.querySelector("summary")?.textContent).toContain(
      `Explore ${visibleIntegrations().length - 6} more integrations`,
    );
  });

  it("links the supported app frontends to their setup docs", () => {
    const root = renderDirectory();
    for (const frontend of frontendPicks()) {
      const link = [...root.querySelectorAll("li a")].find(
        (candidate) => candidate.textContent === frontend.name,
      );
      expect(link?.getAttribute("href")).toBe(
        frontend.id === "react" ? "/quickstart" : `/${frontend.id}`,
      );
    }
  });
});
