import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { AngularSnippet } from "../angular-snippet";

test("renders code extracted from a canonical Angular Showcase region", () => {
  const markup = renderToStaticMarkup(
    <AngularSnippet region="frontend-tool-registration" />,
  );

  expect(markup).toContain("tool-feature-model.ts");
  expect(markup).toContain("change_background");
  expect(markup).not.toContain("@region[");
});

test("surfaces missing regions as an authoring failure", () => {
  const markup = renderToStaticMarkup(
    <AngularSnippet region="not-a-real-region" />,
  );

  expect(markup).toContain("Missing Angular Showcase region");
  expect(markup).toContain("not-a-real-region");
});
