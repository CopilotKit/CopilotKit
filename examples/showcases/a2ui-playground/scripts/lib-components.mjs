/**
 * Shared by the catalog checks: every component's docs page (/components/<name>) renders its sample in [data-preview].
 * BASE is the site's root, including any base path (BASE=http://localhost:3100/a2ui when the app has one).
 */
export const BASE = process.env.BASE ?? "http://localhost:3100";

/**
 * Component names, in sidebar order, read from the /components overview links (the macros page is not a component).
 * The links carry the app's base path when it has one, so they are matched on the segment after /components/.
 * Throws when it finds none, so a check never passes by checking nothing.
 */
export async function componentNames(page, filter) {
  await page.goto(`${BASE}/components`, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  const names = await page.$$eval('a[href*="/components/"]', (as) => [
    ...new Set(
      as
        .map((a) =>
          decodeURIComponent(
            new URL(a.href).pathname.match(/\/components\/([^/]+)\/?$/)?.[1] ??
              "",
          ),
        )
        .filter((n) => n && n !== "macros"),
    ),
  ]);
  if (!names.length)
    throw new Error(`No component links found on ${BASE}/components`);
  return filter ? names.filter((n) => filter.includes(n)) : names;
}

/** Opens a component's page and waits for its preview stage. */
export async function openComponent(page, name, settle = 1200) {
  await page.goto(`${BASE}/components/${name}`, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  await page.waitForSelector(`[data-preview="${name}"]`, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, settle));
}
