import { describe, expect, it, vi } from "vitest";

import { navigateToSearchHref } from "@/lib/search-navigation";

describe("search navigation", () => {
  it("uses the app router internally and browser location for external schemes", () => {
    const push = vi.fn();
    const assign = vi.fn();

    navigateToSearchHref("/reference/hooks/useAgent", { push, assign });
    navigateToSearchHref("https://showcase.test/integrations/mastra", {
      push,
      assign,
    });
    navigateToSearchHref("mailto:docs@copilotkit.ai", { push, assign });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/reference/hooks/useAgent");
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenNthCalledWith(
      1,
      "https://showcase.test/integrations/mastra",
    );
    expect(assign).toHaveBeenNthCalledWith(2, "mailto:docs@copilotkit.ai");
  });
});
