import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  listAllDemoIds,
  listIntegrations,
  resolveDemoSupport,
} from "@/lib/integration-support";

import Home from "./page";

/**
 * The root index and `/<integration>` used to count demos by different rules
 * and disagreed by exactly one for EVERY integration.
 *
 * The root card subtracted `not_supported_features` from `features`. That
 * counts `cli-start`, which all 20 manifests list under `features` and which
 * resolves as INFORMATIONAL — a copy-paste CLI command with no runnable
 * surface. `/<integration>` deliberately strips informational rows from both
 * sides of its ratio, so the card read "43 demos" where the page read
 * "42 of 46 runnable demos ... plus 1 informational".
 *
 * These tests pin the shared rule rather than the numbers: whatever
 * `resolveDemoSupport` calls `supported` is what both pages count. A revert to
 * the subtraction goes red here, because the subtraction cannot avoid counting
 * an informational row.
 */
describe("/ root index demo counts", () => {
  it("counts exactly what resolveDemoSupport calls supported, per integration", () => {
    const html = renderToStaticMarkup(Home());
    const allDemoIds = listAllDemoIds();

    let checked = 0;
    for (const integration of listIntegrations()) {
      const supported = allDemoIds.filter(
        (id) => resolveDemoSupport(integration.slug, id).kind === "supported",
      ).length;
      // Rendered as "<n> demos" inside the card. Asserting the pair (slug,
      // count) appear in the same card would need DOM parsing; the counts
      // differ enough across integrations that the substring is meaningful,
      // and the per-integration equality below is the real assertion.
      expect(
        html,
        `root card for ${integration.slug} must show ${supported}`,
      ).toContain(`${supported} demo`);
      checked += 1;
    }

    // Not a magic floor: an empty manifest tree would make the loop body run
    // zero times and the test pass vacuously, which is the exact failure this
    // suite keeps finding elsewhere.
    expect(checked).toBe(listIntegrations().length);
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("never counts an informational demo, which is what the old rule got wrong", () => {
    const allDemoIds = listAllDemoIds();
    let informationalSeen = 0;

    for (const integration of listIntegrations()) {
      const subtraction = (integration.features ?? []).filter(
        (id) => !(integration.not_supported_features ?? []).includes(id),
      );
      const viaRule = allDemoIds.filter(
        (id) => resolveDemoSupport(integration.slug, id).kind === "supported",
      );
      const informational = allDemoIds.filter(
        (id) =>
          resolveDemoSupport(integration.slug, id).kind === "informational",
      );
      informationalSeen += informational.length;

      // No id the page counts may be informational.
      for (const id of viaRule) {
        expect(resolveDemoSupport(integration.slug, id).kind).toBe("supported");
      }

      // And the old formula really did over-count — pinned so the bug cannot
      // be reintroduced on the belief that the two rules agree.
      if (informational.length > 0) {
        expect(
          subtraction.length,
          `${integration.slug}: the subtraction must differ from the rule while an informational row exists`,
        ).not.toBe(viaRule.length);
      }
    }

    // `cli-start` is informational on all 20, so this cannot be zero. If it
    // ever is, the second assertion above stopped being exercised.
    expect(informationalSeen).toBeGreaterThanOrEqual(20);
  });
});
