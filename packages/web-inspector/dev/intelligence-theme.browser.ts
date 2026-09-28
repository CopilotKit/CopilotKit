import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Hosts the iframe theme contract independently of the Intelligence deployment. */
async function setup(page: Page, production = false) {
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><title>Product view</title>
        <input aria-label="Draft">
        <script>
          const params = new URLSearchParams(location.search);
          const origin = params.get('parentOrigin');
          document.documentElement.dataset.theme = params.get('colorScheme');
          addEventListener('message', event => {
            if (event.source !== parent || event.origin !== origin) return;
            if (event.data?.type === 'cpki:color-scheme' && event.data.version === 1)
              document.documentElement.dataset.theme = event.data.colorScheme;
          });
          parent.postMessage({type:'cpki:theme-request',version:1}, origin);
        </script>`,
    }),
  );
  await page.goto(
    `/?scenario=pro-enabled-existing&reset=1&intelligenceAppUrl=https%3A%2F%2Fintelligence.example%2Finspector.html${production ? "&intelligenceMode=production" : ""}`,
  );
  await page.locator('[data-inspector-menu-key="analytics"]').click();
  return {
    frame: page.frameLocator('iframe[title="Analytics"]'),
    iframe: page.locator('iframe[title="Analytics"]'),
  };
}

test("the existing theme toggle updates product views without losing draft or route", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const world = await setup(page);
  await expect(world.frame.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await world.frame
    .getByRole("textbox", { name: "Draft" })
    .fill("Keep my question");
  await world.frame.locator("html").evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("view", "tool");
    url.searchParams.set("tool", "refund");
    history.replaceState(null, "", url);
  });
  const src = await world.iframe.getAttribute("src");

  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .press("Enter");
  await expect(world.frame.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(world.frame.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "Keep my question",
  );
  expect(await world.iframe.getAttribute("src")).toBe(src);
  expect(
    await world.frame
      .locator("html")
      .evaluate(() => new URL(location.href).searchParams.get("tool")),
  ).toBe("refund");

  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(world.frame.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await page.locator('[data-inspector-menu-key="governance"]').click();
  await expect(
    page.frameLocator('iframe[title="Governance"]').locator("html"),
  ).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(
    page.frameLocator('iframe[title="Governance"]').locator("html"),
  ).toHaveAttribute("data-theme", "dark");
});

test("production follows system theme changes without replacing the product view", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const world = await setup(page, true);
  await expect(world.frame.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await world.frame
    .getByRole("textbox", { name: "Draft" })
    .fill("Keep production state");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(world.frame.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await expect(world.frame.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "Keep production state",
  );
  await page.locator('[data-inspector-menu-key="memories"]').click();
  await expect(
    page.frameLocator('iframe[title="Learning"]').locator("html"),
  ).toHaveAttribute("data-theme", "dark");
});
