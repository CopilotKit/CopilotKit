import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const layoutSource = readFileSync(
  new URL("../shell-docs-layout.tsx", import.meta.url),
  "utf8",
);
const mobileTalkSource = readFileSync(
  new URL("../mobile-sidebar-footer-talk.tsx", import.meta.url),
  "utf8",
);

test("sidebar banner includes the picker and mobile docs tabs", () => {
  const bannerIndex = layoutSource.lastIndexOf("{banner}");
  const tabsIndex = layoutSource.indexOf(
    '<PrimaryDocsTabs className="shell-docs-mobile-sidebar-tabs" />',
  );

  expect(bannerIndex).toBeGreaterThanOrEqual(0);
  expect(tabsIndex).toBeGreaterThanOrEqual(0);
  expect(layoutSource).not.toContain("SidebarIntelligenceEntry");
});

test("mobile sidebar talk CTA uses the primary accent treatment", () => {
  expect(mobileTalkSource).toContain("bg-[var(--accent)]");
  expect(mobileTalkSource).toContain("hover:bg-[var(--accent-strong)]");
  expect(mobileTalkSource).toContain("text-[var(--primary-foreground)]");
});
