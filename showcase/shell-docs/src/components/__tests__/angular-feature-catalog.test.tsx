import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { AngularFeatureCatalog } from "../angular-feature-catalog";

test("shows only claims supplied by the Angular feature registry", () => {
  const markup = renderToStaticMarkup(<AngularFeatureCatalog />);

  expect(markup).toContain("View source");
  expect(markup).toContain("API inventory");
  expect(markup).not.toMatch(
    /loading, failure, recovery|SSR-safe|hydration|Compiling source/,
  );
});
