import { expect, test } from "@playwright/test";

/**
 * Beat 3d's claim, minus the agent: a filed board is a real page with its own
 * URL that does not belong to any conversation. This posts through the exact
 * endpoint `buildBoard` calls (`POST /api/vantage/v1/boards`) with no chat
 * involved, then proves the response is a durable artifact — reachable at its
 * own URL and listed on the boards index — rather than something that only
 * exists inside the thread that asked for it.
 *
 * The store is process-lifetime and shared with the dev server under test, so
 * these assertions are derived from the slug the POST actually returns rather
 * than assuming a pristine store or a specific board count.
 */
test.describe("vantage filed board artifact", () => {
  test("POST /api/vantage/v1/boards files a board reachable at its own URL and listed on the index", async ({
    page,
    request,
  }) => {
    const res = await request.post("/api/vantage/v1/boards", {
      data: {
        title: "E2E filed board",
        summary: "Filed by a test, not by a thread.",
        lens: { period: "q3-2026", region: "emea" },
        tiles: [
          { kind: "kpi", metric: "arr", label: "ARR" },
          { kind: "waterfall", metric: "arr", label: "Plan variance" },
        ],
        notes: ["Headcount ended at 412 against a plan of 420."],
        sourceDocument: "Q2-2026-executive-review.pdf",
      },
    });
    expect(res.status()).toBe(201);
    const { board } = await res.json();

    // The artifact has its own page at /vantage/boards/<slug> — the detail
    // page's title heading, the sourceDocument chip and the note all render
    // from the filed board, not from any conversation.
    await page.goto(`/vantage/boards/${board.slug}`);
    await expect(
      page.getByRole("heading", { name: "E2E filed board" }),
    ).toBeVisible();
    await expect(page.getByText("Q2-2026-executive-review.pdf")).toBeVisible();
    await expect(
      page.getByText("Headcount ended at 412 against a plan of 420."),
    ).toBeVisible();

    // And it is listed on the boards index.
    await page.goto("/vantage/boards");
    await expect(page.getByText("E2E filed board")).toBeVisible();
  });

  test("an unknown board slug renders a not-found message rather than an empty page", async ({
    page,
  }) => {
    await page.goto("/vantage/boards/no-such-board");
    await expect(page.getByText("That board no longer exists.")).toBeVisible();
  });
});
