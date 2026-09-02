// The cookbook routes render on the ROOT surface, so their page-tools row
// names the Built-in Agent in the "Copy agent prompt" button — the same
// framework `/<framework>/cookbook/<slug>` names, and the same one every other
// root-surface page names.
//
// Asserted by CALLING the route components and reading the `DocsPageView`
// element they return. Rendering them would compile the recipe's MDX and mount
// the whole docs shell, none of which this rule depends on.

import { describe, expect, it } from "vitest";
import CookbookLandingPage from "./page";
import CookbookSlugPage from "./[...slug]/page";

const BIA = { slug: "built-in-agent", name: "Built-in Agent" };

describe("cookbook onboarding framework", () => {
  it("names the Built-in Agent on the cookbook landing page", () => {
    const element = CookbookLandingPage() as {
      props: Record<string, unknown>;
    };

    expect(element.props.slugPath).toBe("cookbook");
    expect(element.props.onboardingFramework).toEqual(BIA);
  });

  it("names the Built-in Agent on a cookbook recipe", async () => {
    const element = (await CookbookSlugPage({
      params: Promise.resolve({ slug: ["arcade"] }),
    })) as { props: Record<string, unknown> };

    expect(element.props.slugPath).toBe("cookbook/arcade");
    expect(element.props.onboardingFramework).toEqual(BIA);
  });
});
