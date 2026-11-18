/**
 * Shared by the catalog checks: every component's docs page (/components/<name>) renders its sample in [data-preview].
 * BASE is the site's root, including any base path (BASE=http://localhost:3100/a2ui when the app has one); a
 * trailing slash is dropped.
 */
export const BASE = (process.env.BASE ?? "http://localhost:3100").replace(
  /\/+$/,
  "",
);

/**
 * Component names, in sidebar order, read from the /components overview links (the macros page is not a component).
 * The links carry the app's base path when it has one, so they are matched under BASE's own path, on this origin.
 * Throws when it finds none, or when `filter` is empty or names anything that is not a component, so a check never
 * passes by checking nothing or by quietly checking less than it was asked to.
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
  const wanted = filter.map((n) => n.trim()).filter(Boolean);
  const unknown = wanted.filter((n) => !names.includes(n));
  if (!wanted.length || unknown.length)
    throw new Error(
      `Not a component on ${BASE}/components: ${unknown.join(", ") || "(empty filter)"}`,
    );
  return names.filter((n) => wanted.includes(n));
}

/**
 * Opens a component's page. Returns true once its preview stage is there, or false for a Gen UI 2.0 standard
 * component's page rendered without one: a standard component with no sample shows its props only. The stage and
 * the page's breadcrumb are in the server-rendered HTML, so that is known as soon as the page loads. A page that
 * answers with an error, that is not the component's own page, or that is one of the playground's own components
 * without a stage (every one of them has a sample) throws: it must never pass as a component with no sample.
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
    const standard = await page.$(
      'nav[aria-label="Breadcrumb"] a[href$="/components#standard"]',
    );
    if (!standard)
      throw new Error(
        `${url} has no preview stage, but ${name} is one of the playground's own components`,
      );
    return false;
  }
  await new Promise((r) => setTimeout(r, settle));
  return true;
}
