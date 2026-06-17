import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../framework-provider", () => ({
  useFramework: () => ({
    setStoredFramework: vi.fn(),
  }),
}));

import { HeroQuickstartDropdown } from "../hero-quickstart-dropdown";

describe("HeroQuickstartDropdown", () => {
  it("uses the accent CTA treatment for the quickstart trigger", () => {
    const markup = renderToStaticMarkup(
      <HeroQuickstartDropdown
        options={[
          {
            slug: "built-in-agent",
            name: "CopilotKit's Built-in Agent",
            href: "/react",
          },
        ]}
      />,
    );

    expect(markup).toContain("border-[var(--accent)]");
    expect(markup).toContain("bg-[var(--accent)]");
    expect(markup).toContain("text-[var(--primary-foreground)]");
    expect(markup).toContain("hover:bg-[var(--accent-strong)]");
    expect(markup).not.toContain("bg-[#000000]");
    expect(markup).not.toContain("hover:bg-[#1f1f1f]");
  });
});
