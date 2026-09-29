import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Measures rendered button text against its composited ancestor backgrounds. */
async function learningTabContrast(page: Page, name: string): Promise<number> {
  return page
    .getByLabel("Learning views")
    .getByRole("button", { name, exact: true })
    .evaluate((button) => {
      const parse = (color: string): number[] =>
        color.match(/[\d.]+/g)!.map(Number);
      const layers: number[][] = [];
      let node: Element | null = button;
      while (node) {
        layers.unshift(parse(getComputedStyle(node).backgroundColor));
        node =
          node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
      }
      const background = layers.reduce(
        (base, layer) => {
          const alpha = layer[3] ?? 1;
          return base.map((value, index) => {
            const channel = layer[index];
            if (channel === undefined) throw new Error("Missing color channel");
            return channel * alpha + value * (1 - alpha);
          });
        },
        [255, 255, 255],
      );
      const luminance = (color: number[]): number =>
        color.slice(0, 3).reduce((sum, value, index) => {
          const channel = value / 255;
          const weight = [0.2126, 0.7152, 0.0722][index];
          if (weight === undefined) throw new Error("Missing luminance weight");
          return (
            sum +
            (channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4) *
              weight
          );
        }, 0);
      const foreground = luminance(parse(getComputedStyle(button).color));
      const surface = luminance(background);
      return (
        (Math.max(foreground, surface) + 0.05) /
        (Math.min(foreground, surface) + 0.05)
      );
    });
}

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

test("Learning view labels remain readable when switching theme and selected view", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page);
  await page.locator('[data-inspector-menu-key="memories"]').click();
  const tabs = page.getByLabel("Learning views");
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page
        .getByRole("button", { name: "Switch to light mode", exact: true })
        .click();
    for (const selected of ["Workbench", "Insights & Skills"]) {
      await tabs.getByRole("button", { name: selected, exact: true }).click();
      await expect(
        tabs.getByRole("button", { name: selected, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.mouse.move(0, 0);
      for (const name of ["Workbench", "Insights & Skills"]) {
        expect(
          await learningTabContrast(page, name),
          `${theme} ${selected}: ${name}`,
        ).toBeGreaterThanOrEqual(4.5);
        await tabs.getByRole("button", { name, exact: true }).hover();
        expect(
          await learningTabContrast(page, name),
          `${theme} hover: ${name}`,
        ).toBeGreaterThanOrEqual(4.5);
        await page.mouse.move(0, 0);
      }
    }
  }
});
