import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../framework-provider", () => ({
  useFramework: () => ({ storedFramework: "built-in-agent" }),
}));

import { StoredFrameworkHighlight } from "../stored-framework-highlight";

describe("StoredFrameworkHighlight", () => {
  it("keeps the selected label out of cramped mobile backend cards", () => {
    const markup = renderToStaticMarkup(
      <StoredFrameworkHighlight slug="built-in-agent" />,
    );

    expect(markup).toContain("sr-only");
    expect(markup).toContain("Current backend selection");
  });
});
