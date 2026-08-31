import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams("threads-path=cli"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.searchParams,
}));

import { TailoredContent, TailoredContentOption } from "../tailored-content";

describe("TailoredContent", () => {
  it("renders implementation path options as native buttons with a selected affordance", () => {
    const markup = renderToStaticMarkup(
      <TailoredContent id="threads-path">
        <TailoredContentOption
          id="cli"
          title="Start with the CLI"
          description="Bootstrap a new full-stack project pre-configured for threads."
          icon={<span />}
        >
          <p>CLI content</p>
        </TailoredContentOption>
        <TailoredContentOption
          id="manual"
          title="Add to an existing app"
          description="Wire threads into a project you already have."
          icon={<span />}
        >
          <p>Manual content</p>
        </TailoredContentOption>
      </TailoredContent>,
    );

    expect(markup.match(/<button/g)?.length).toBe(2);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-label="Start with the CLI, selected"');
    expect(markup).toContain("tailored-content-selected-indicator");
    expect(markup).toContain("CLI content");
    expect(markup).not.toContain("Manual content");
  });
});
