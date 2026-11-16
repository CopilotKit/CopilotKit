/**
 * Shared by the catalog checks: every component's docs page (/components/<name>) renders its sample in [data-preview].
 * BASE is the site's root, including any base path (BASE=http://localhost:3100/a2ui when the app has one).
 */
export const BASE = process.env.BASE ?? "http://localhost:3100";

/**
 * Component names, in sidebar order, read from the /components overview links (the macros page is not a component).
 * The links carry the app's base path when it has one, so they are matched under BASE's own path, on this origin.
 * Throws when it finds none, or when `filter` names none of them, so a check never passes by checking nothing.
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
  if (!filter) return names;
  const picked = names.filter((n) => filter.includes(n));
  if (!picked.length)
    throw new Error(
      `None of ${filter.join(", ")} is a component on ${BASE}/components`,
    );
  return picked;
}

/**
 * Opens a component's page. Returns true once its preview stage is there, or false for the component's own page
 * rendered without one: a Gen UI 2.0 standard component with no sample shows its props only. The stage is in the
 * server-rendered HTML, so that is known as soon as the page loads. A page that answers with an error, or that is
 * not the component's own page, throws: it must never pass as a component that merely has no sample.
 */
export async function openComponent(page, name, settle = 1200) {
  const url = `${BASE}/components/${name}`;
  const res = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 120000,
  });
  if (!res?.ok())
    throw new Error(`${url} answered ${res?.status() ?? "nothing"}`);
  if (!(await page.$(`[data-preview="${name}"]`))) {
    const heading = await page
      .$eval("main h1", (h) => h.textContent?.trim())
      .catch(() => null);
    if (heading !== name)
      throw new Error(
        `${url} is not ${name}'s page (h1: ${heading ?? "none"})`,
      );
    return false;
  }
  await new Promise((r) => setTimeout(r, settle));
  return true;
}
