import { describe, expect, it } from "vitest";
import { partnerShowcaseDemos } from "../partner-showcase-demos";
import { getIntegrations, getDemo } from "../registry";
import catalog from "@/data/frontend-catalog.json";

describe("partner showcase links", () => {
  it.each(["react", "angular"] as const)(
    "only advertises exact runnable %s cells for every visible partner",
    (frontend) => {
      const partners = getIntegrations().filter(
        (i) => i.docs_mode !== "hidden" && i.slug !== "built-in-agent",
      );
      expect(partners.length).toBeGreaterThan(10);
      for (const partner of partners) {
        const demos = partnerShowcaseDemos(partner.slug, frontend);
        const hasShowcase = catalog.cells.some(
          (cell) =>
            cell.frontend === frontend &&
            cell.integration === partner.slug &&
            cell.runnable,
        );
        if (hasShowcase) expect(demos.length, partner.slug).toBeGreaterThan(0);
        else expect(demos, partner.slug).toEqual([]);
        for (const demo of demos) {
          const source = getDemo(partner.slug, demo.id)!;
          expect(demo.embedHref).toBe(
            new URL(
              frontend === "angular"
                ? `/angular/${demo.id}`
                : // partnerShowcaseDemos only returns demos that have a route.
                  source.demo.route!,
              source.integration.backend_url,
            ).href,
          );
          expect(demo.href).toBe(
            `https://showcase.copilotkit.ai/${frontend}/${partner.slug}/${demo.id}`,
          );
          expect(
            catalog.cells.some(
              (cell) =>
                cell.frontend === frontend &&
                cell.integration === partner.slug &&
                cell.feature === demo.id &&
                cell.runnable,
            ),
          ).toBe(true);
        }
      }
    },
  );
  it("does not substitute another partner when no demos exist", () => {
    expect(partnerShowcaseDemos("agent-spec")).toEqual([]);
    expect(partnerShowcaseDemos("missing-partner")).toEqual([]);
  });
});
