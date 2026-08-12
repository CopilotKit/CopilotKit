import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import AeoPolicyPage from "./page";

test("renders the shared policy classifications, ownership, and review checklist", () => {
  const html = renderToStaticMarkup(<AeoPolicyPage />);

  expect(html).toContain("Public AEO surface contract");
  expect(html).toContain("Standards and ecosystem conventions");
  expect(html).toContain("Response semantics");
  expect(html).toContain("Owners");
  expect(html).toContain("Ownership and enforcement");
  expect(html).toContain("Review checklist");
  expect(html).toContain('type="application/ld+json"');
  expect(html).toContain("https://www.copilotkit.ai");
  expect(html).toContain("https://docs.copilotkit.ai");
  expect(html).toContain("https://mcp.copilotkit.ai");
});
