import { expect, test } from "@playwright/test";

/**
 * The LOCK_SKIN single-tenant deploy shape. Runs against its own dev server
 * (the `locked` project in playwright.config.ts, `LOCK_SKIN=banking`).
 *
 * WHY THIS SUITE EXISTS. Everything here is invisible to the unlocked specs, and
 * most of it is invisible to unit tests too. `proxy.test.ts` proves the rewrite
 * MAPPING and `skin-path.test.tsx` proves the href BUILDER, but neither proves
 * the two halves agree in a running app — that the skin layouts actually call
 * the builder instead of hardcoding a prefix. That defect renders a perfectly
 * working page; the only symptom is `/banking` reappearing in the address bar.
 * It has to be caught in a browser, against a locked server.
 *
 * The skin is `banking` (see LOCKED_SKIN in the config), so its pages are `/`
 * (credit cards), `/dashboard`, `/charges`, `/team`.
 */

test.describe("LOCK_SKIN — the skin is served at the root", () => {
  test("`/` renders the locked skin itself, with no redirect", async ({
    page,
  }) => {
    const response = await page.goto("/");
    // Not a 3xx to /banking — the whole point. A redirect would put the tenant
    // id in front of the user on the front door.
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByTestId("skin-selector")).toBeVisible();
  });

  test("the tab and unfurl metadata are branded, not the demo's", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Northwind Finance");
    // Positively assert the locked skin's own tagline, as strictly as the title
    // above. An exact match is null-safe (a missing meta fails loud, not with an
    // opaque null throw) and, unlike a bare `.not.toContain`, it proves the
    // branded description is actually there — while still excluding the
    // multi-skin substrate's "…many app skins." tagline.
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Collaborative finance for 21st century teams",
    );
  });

  test("the switcher is a static badge, so the deploy admits to one tenant", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("skin-brand-locked")).toBeVisible();
    await expect(page.getByTestId("skin-selector-trigger")).toHaveCount(0);
  });
});

test.describe("LOCK_SKIN — the prefix is gone from the URL space", () => {
  // THE regression this suite is really for. A hardcoded `/banking/...` href
  // still navigates correctly, so only the rendered href reveals the defect.
  test("no in-app link carries the skin prefix", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("skin-selector")).toBeVisible();

    // POSITIVE precondition FIRST. Without this the negative assertions below
    // pass vacuously: if the nav never mounted (a throwing provider, a renamed
    // selector), the match set is empty and the suite's headline guard proves
    // nothing while staying green. So require the in-app anchors to actually be
    // there, and the known banking nav targets among them, BEFORE asserting the
    // prefix is absent.
    const inApp = page.locator('a[href^="/"]');
    const hrefs = await inApp.evaluateAll((els) =>
      els.map((el) => el.getAttribute("href") ?? ""),
    );
    expect(hrefs.length, "expected in-app links to render").toBeGreaterThan(0);
    // Require only the ROLE-INDEPENDENT banking nav targets. `/team` is
    // deliberately NOT in this set: it is admin-gated
    // (src/skins/banking/layout.tsx renders the "team" nav entry only when
    // currentUser.role === MemberRole.Admin), and the default user is just
    // team[0] from the seed. Asserting `/team` here would silently couple this
    // LOCK_SKIN guard to seed order and the default user's role — reorder the
    // roster or flip that user to a non-admin and the suite would fail on an
    // assertion that has nothing to do with the prefix. Do NOT re-add `/team`.
    // (The `/team` route itself is still covered, role-independently, by the
    // cold deep-page load test below.)
    for (const target of ["/", "/dashboard", "/charges"]) {
      expect(hrefs, `banking nav must render ${target}`).toContain(target);
    }

    // THE guard: no rendered href carries the skin prefix. A hardcoded
    // `/banking/...` still navigates correctly, so only the href reveals it.
    const prefixed = hrefs.filter((href) => href.startsWith("/banking"));
    expect(prefixed, "links must be built with useSkinHref").toEqual([]);

    // The OTHER way the builder breaks: a protocol-relative `//host` href
    // navigates off-site entirely. Nothing else in the suite catches it.
    const protocolRelative = hrefs.filter((href) => href.startsWith("//"));
    expect(protocolRelative, "no in-app href may be protocol-relative").toEqual(
      [],
    );
  });

  test("clicking a nav entry keeps the URL prefix-free and marks it active", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator('nav a[href="/dashboard"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('nav a[href="/dashboard"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a deep page loads directly at its prefix-free URL", async ({
    page,
  }) => {
    // Proves the rewrite works on a cold request, not only on client nav.
    const response = await page.goto("/team");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/team$/);
  });
});

test.describe("LOCK_SKIN — everything else is absent", () => {
  // Rendered-result assertions, not status assertions: `notFound()` raised from
  // the client PAGE component cannot change a status Next already committed, so
  // these paths answer 200 with the 404 document. Pre-existing and unrelated to
  // the lock — `/banking/nope` behaves the same on an UNLOCKED server.
  for (const path of ["/banking", "/airline", "/keel", "/nope"]) {
    test(`${path} renders the not-found page`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByText("This page could not be found"),
      ).toBeVisible();
      await expect(page.getByTestId("skin-selector")).toHaveCount(0);
    });
  }

  test("the runtime endpoint is NOT rewritten", async ({ request }) => {
    // If the proxy matcher ever admits /api, the agent SSE stream is rewritten
    // to /banking/api/copilotkit and every run in the app dies.
    const res = await request.get("/api/copilotkit/info");
    expect(res.status()).toBe(200);
  });

  test("a public asset is NOT rewritten", async ({ request }) => {
    // Banking's Q2-invoice beat loads this as a real PDF.
    const res = await request.get("/sample-invoice-q2.pdf");
    expect(res.status()).toBe(200);
  });
});
