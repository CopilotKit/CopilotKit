// Keeps the set of docs pages a reviewed decision. Fails when:
//   - a page file is added or removed and page-inventory.json wasn't updated,
//   - a page is in no sidebar (no meta.json lists it) and isn't on the
//     inventory's `unlisted` list, which names each page readers reach only
//     through a landing page or a link,
//   - with BASE_URL set, the sitemap's URLs differ from the inventory's.
// After an intended change, run with --update (and BASE_URL for the sitemap)
// and commit page-inventory.json so the change shows up in review.
//   node scripts/check-page-inventory.mjs [--update]
//   BASE_URL=http://localhost:3003 node scripts/check-page-inventory.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "src", "content", "docs");
const inventoryPath = join(root, "page-inventory.json");
const update = process.argv.includes("--update");
const base = process.env.BASE_URL;

const pages = [];
const metas = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".mdx")) pages.push(relative(docs, p));
    else if (e.name === "meta.json") metas.push(relative(docs, p));
  }
})(docs);
pages.sort();

// Everything some meta.json lists: pages and folders by path, link rows by URL.
const listed = new Set();
const wholeFolders = new Set();
const urlOf = (path) =>
  "/" +
  path
    .split("/")
    .filter((s) => !/^\(.*\)$/.test(s))
    .join("/");
for (const meta of metas) {
  const dir = dirname(meta);
  const { pages: rows } = JSON.parse(readFileSync(join(docs, meta), "utf8"));
  if (!rows) wholeFolders.add(dir);
  (function walk(items = []) {
    for (const item of items) {
      if (typeof item === "object") walk(item.pages);
      else if (item === "...") wholeFolders.add(dir);
      else if (item.startsWith("---")) continue;
      else {
        const link = item.match(/^\[.*\]\((\/[^)]*)\)$/);
        if (link) listed.add(`url:${link[1]}`);
        else listed.add(normalize(join(dir, item.replace(/^\.\.\./, ""))));
      }
    }
  })(rows);
}

function inSidebar(page) {
  const folder = dirname(page);
  const self = page.replace(/\.mdx$/, "").replace(/\/index$/, "");
  if (listed.has(self) || wholeFolders.has(folder)) return true;
  if (listed.has(`url:${urlOf(self)}`)) return true;
  // Vue, Angular and React Native pages fill rows of the app outline by slug.
  const fe = self.match(/^frontends\/(?:vue|angular|react-native)\/(.+)$/);
  return Boolean(
    fe &&
    (listed.has(fe[1]) ||
      listed.has(join("(shared)", fe[1])) ||
      listed.has(`url:/${fe[1]}`)),
  );
}

async function sitemap() {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => new URL(m[1]).pathname)
    .sort();
}

const old = existsSync(inventoryPath)
  ? JSON.parse(readFileSync(inventoryPath, "utf8"))
  : { pages: [], unlisted: [], sitemap: [] };
const orphans = pages.filter((p) => !inSidebar(p));

if (update) {
  const next = {
    pages,
    unlisted: orphans,
    sitemap: base ? await sitemap() : old.sitemap,
  };
  writeFileSync(inventoryPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `[page-inventory] wrote ${pages.length} pages, ${orphans.length} unlisted, ${next.sitemap.length} sitemap URLs`,
  );
  process.exit(0);
}

const problems = [];
const diff = (label, was, now) => {
  const a = new Set(was);
  const b = new Set(now);
  for (const x of now) if (!a.has(x)) problems.push(`${label} added: ${x}`);
  for (const x of was) if (!b.has(x)) problems.push(`${label} removed: ${x}`);
};
diff("page", old.pages, pages);
for (const p of orphans) {
  if (!old.unlisted.includes(p)) problems.push(`page in no sidebar: ${p}`);
}
if (base) diff("sitemap URL", old.sitemap, await sitemap());

if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(
    "\n[page-inventory] The docs' pages changed. If that's intended, run\n" +
      "  BASE_URL=http://localhost:3003 node scripts/check-page-inventory.mjs --update\n" +
      "and commit page-inventory.json so reviewers see the change.",
  );
  process.exit(1);
}
console.log(
  `[page-inventory] ${pages.length} pages, ${orphans.length} unlisted${base ? `, ${old.sitemap.length} sitemap URLs` : ""}: unchanged`,
);
