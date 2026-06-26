/**
 * OpenBox Governance-Feed / Execution-Tree side panel — E2E.
 *
 * Structural assertions (panel mounts, empty state, populates after a run)
 * run against the unprovisioned permissive local stack. Verdict-matrix
 * assertions require live OpenBox creds and are gated like governance.spec.ts.
 */
import { test, expect } from "@playwright/test";
import {
  openFresh,
  clickSuggestion,
  expectOpenBoxDecision,
  expectFeedVisible,
  expectFeedRunCountAtLeast,
  expectFeedNodeVerdict,
} from "./helpers";

const HAS_OPENBOX = Boolean(
  process.env.OPENBOX_API_KEY && process.env.OPENBOX_CORE_URL,
);

test.describe("OpenBox governance feed · structural", () => {
  test.describe.configure({ timeout: 300_000 });

  test("panel mounts with an empty state on load", async ({ page }) => {
    await openFresh(page, "feed-empty");
    await expectFeedVisible(page);
    await expect(page.getByTestId("openbox-feed-empty")).toBeVisible();
  });

  test("running a governed action populates the tree", async ({ page }) => {
    await openFresh(page, "feed-populate");
    await expectFeedVisible(page);
    await clickSuggestion(page, "Review Work Queue");
    // A decision card appears in chat...
    await expectOpenBoxDecision(
      page,
      /Allowed|Redacted|Constrained|Blocked|Halted|Rejected/i,
    );
    // ...and the feed gains at least one run group.
    await expectFeedRunCountAtLeast(page, 1);
  });
});

const describeMatrix = HAS_OPENBOX ? test.describe : test.describe.skip;

describeMatrix("OpenBox governance feed · verdict matrix", () => {
  test.describe.configure({ timeout: 900_000 });

  test("allow action renders an allow badge in the feed", async ({ page }) => {
    await openFresh(page, "feed-allow");
    await clickSuggestion(page, "Review Work Queue");
    await expectOpenBoxDecision(page, /Allowed/i);
    await expectFeedNodeVerdict(page, "allow");
  });

  test("block action renders a block badge in the feed", async ({ page }) => {
    await openFresh(page, "feed-block");
    await clickSuggestion(page, "Send Exception IDs");
    await expectOpenBoxDecision(page, /Blocked|Halted|Rejected/i);
    await expectFeedNodeVerdict(page, "block");
  });

  test("halt action renders a halt badge in the feed", async ({ page }) => {
    await openFresh(page, "feed-halt");
    await clickSuggestion(page, "Update Vendor Bank");
    await expectOpenBoxDecision(page, /Halted|Blocked/i);
    await expectFeedNodeVerdict(page, "halt");
  });
});
