import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const layoutSource = readFileSync(
  new URL("../shell-docs-layout.tsx", import.meta.url),
  "utf8",
);

test("sidebar banner keeps the pickers above the mobile docs tabs", () => {
  const bannerIndex = layoutSource.lastIndexOf("{banner}");
  const tabsIndex = layoutSource.indexOf(
    '<PrimaryDocsTabs className="shell-docs-mobile-sidebar-tabs" />',
  );

  expect(bannerIndex).toBeGreaterThanOrEqual(0);
  expect(tabsIndex).toBeGreaterThan(bannerIndex);
  expect(layoutSource).not.toContain("SidebarIntelligenceEntry");
});
