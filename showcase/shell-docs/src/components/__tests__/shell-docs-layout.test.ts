import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const layoutSource = readFileSync(
  new URL("../shell-docs-layout.tsx", import.meta.url),
  "utf8",
);

test("sidebar banner puts pickers above the Intelligence pin", () => {
  const bannerIndex = layoutSource.lastIndexOf("{banner}");
  const intelligenceIndex = layoutSource.lastIndexOf(
    "<SidebarIntelligenceEntry",
  );
  const tabsIndex = layoutSource.indexOf(
    '<PrimaryDocsTabs className="shell-docs-mobile-sidebar-tabs" />',
  );

  expect(bannerIndex).toBeGreaterThanOrEqual(0);
  expect(intelligenceIndex).toBeGreaterThan(bannerIndex);
  expect(tabsIndex).toBeGreaterThan(intelligenceIndex);
});
