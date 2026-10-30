/** Shared by the catalog checks: every component's docs page (/components/<name>) renders its sample in [data-preview]. */
export const BASE = process.env.BASE ?? "http://localhost:3100";

/** Component names, in sidebar order, read from the /components overview links (the macros page is not a component). */
export async function componentNames(page, filter) {
  await page.goto(`${BASE}/components`, { waitUntil: "networkidle2", timeout: 120000 });
  const names = await page.$$eval('a[href^="/components/"]', (as) => [...new Set(as.map((a) => a.getAttribute("href").split("/")[2]).filter((n) => n && n !== "macros"))]);
  return filter ? names.filter((n) => filter.includes(n)) : names;
}

/** Opens a component's page and waits for its preview stage. */
export async function openComponent(page, name, settle = 1200) {
  await page.goto(`${BASE}/components/${name}`, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForSelector(`[data-preview="${name}"]`, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, settle));
}
