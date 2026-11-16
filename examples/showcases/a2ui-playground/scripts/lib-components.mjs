/**
 * Shared by the catalog checks: every component's docs page (/components/<name>) renders its sample in [data-preview].
 * BASE is the site's root, including any base path (BASE=http://localhost:3100/a2ui when the app has one).
 */
export const BASE = process.env.BASE ?? "http://localhost:3100";

/**
 * Component names, in sidebar order, read from the /components overview links (the macros page is not a component).
 * The links carry the app's base path when it has one, so they are matched under BASE's own path, on this origin
 * only (the overview also links to CopilotKit's docs, whose URL has a /components/ in it).
 * Throws when it finds none, so a check never passes by checking nothing.
 */
export async function componentNames(page, filter) {
  await page.goto(`${BASE}/components`, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  const prefix = new URL(`${BASE}/components/`).pathname;
  const names = await page.$$eval(
    "a[href]",
    (as, under) => [
      ...new Set(
        as
          .filter(
            (a) => a.origin === location.origin && a.pathname.startsWith(under),
          )
          .map((a) => decodeURIComponent(a.pathname.slice(under.length)))
          .filter((n) => n && !n.includes("/") && n !== "macros"),
      ),
    ],
    prefix,
  );
  if (!names.length)
    throw new Error(`No component links found on ${BASE}/components`);
  return filter ? names.filter((n) => filter.includes(n)) : names;
}

/**
 * Opens a component's page and waits for its preview stage. Returns false for a page without one: a Gen UI 2.0
 * standard component with no sample shows its props only. The stage is in the server-rendered HTML, so a page
 * without it is known as soon as it loads.
 */
export async function openComponent(page, name, settle = 1200) {
  await page.goto(`${BASE}/components/${name}`, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  const stage = `[data-preview="${name}"]`;
  if (!(await page.$(stage))) return false;
  await page.waitForSelector(stage, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, settle));
  return true;
}
