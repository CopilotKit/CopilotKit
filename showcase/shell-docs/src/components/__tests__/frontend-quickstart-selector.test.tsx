import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/react",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("../framework-provider", () => ({
  useFramework: () => ({
    effectiveFramework: "built-in-agent",
    framework: null,
  }),
}));

import { FrontendQuickstartSelector } from "../frontend-quickstart-selector";

describe("FrontendQuickstartSelector", () => {
  it("labels the selected frontend picker as a frontend quickstart", () => {
    const markup = renderToStaticMarkup(<FrontendQuickstartSelector />);

    expect(markup).toContain("Frontend Quickstart");
    expect(markup).not.toContain("App frontend quickstart");
  });

  it("uses the same sidebar selector sizing and selected surface as the backend picker", () => {
    const markup = renderToStaticMarkup(<FrontendQuickstartSelector />);

    expect(markup).toContain("h-12");
    expect(markup).toContain("bg-[var(--accent-dim)]");
    expect(markup).toContain("border-[var(--nav-control-border)]");
    expect(markup).toContain("hover:bg-[var(--accent-light)]");
    expect(markup).toContain("h-8 w-8 shrink-0");
  });
});
