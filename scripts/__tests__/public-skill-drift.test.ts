import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skillsDir = resolve(root, "skills");
const contentDir = resolve(root, "showcase/shell-docs/src/content");

/**
 * The packaged skills used to transcribe CopilotKit's API surface, and this
 * suite guarded the copies: skill versions against the public API manifest,
 * setup assets against real entrypoints, `sources.md` inventories against real
 * files. Those copies are gone — the skills now point at the documentation and
 * the CLI instead of restating them.
 *
 * The rot moved with them. A pointer-based skill fails by naming a docs path
 * that no longer resolves, which is silent: an agent follows the link, gets
 * nothing, and answers from memory instead. That is what this guards now.
 */

/** Every `.md` under `skills/`, as [relative path, contents]. */
function skillFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md"))
        out.push([full.slice(root.length + 1), readFileSync(full, "utf8")]);
    }
  };
  walk(skillsDir);
  return out;
}

/**
 * Resolves a docs path to the file that serves it.
 *
 * A page can live at the content root or, for a framework-scoped page, under
 * `integrations/<framework>/`, which is how `/server-tools` is served with no
 * root `server-tools.mdx`. A directory with an `index.mdx` counts too.
 */
function docsPathResolves(docsPath: string): boolean {
  const slug = docsPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (slug === "") return true;
  const candidates = [
    join(contentDir, "docs", `${slug}.mdx`),
    join(contentDir, "docs", slug, "index.mdx"),
    join(contentDir, `${slug}.mdx`),
    join(contentDir, slug, "index.mdx"),
  ];
  if (candidates.some(existsSync)) return true;
  // Framework-scoped: docs/integrations/<any>/<slug>.mdx
  const integrations = join(contentDir, "docs/integrations");
  if (!existsSync(integrations)) return false;
  return readdirSync(integrations, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .some((e) => existsSync(join(integrations, e.name, `${slug}.mdx`)));
}

describe("packaged skills point at pages that exist", () => {
  const files = skillFiles();

  it("finds skill files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names only docs paths that resolve to a page", () => {
    const broken: string[] = [];
    for (const [path, contents] of files) {
      // Absolute docs.copilotkit.ai links and bare site-root paths in prose.
      const absolute = [
        ...contents.matchAll(
          /https:\/\/docs\.copilotkit\.ai(\/[A-Za-z0-9._/-]*)/g,
        ),
      ].map((m) => m[1]);
      const relative = [
        ...contents.matchAll(/\]\((\/[A-Za-z0-9._/-]+)\)/g),
      ].map((m) => m[1]);
      for (const raw of [...absolute, ...relative]) {
        const docsPath = raw.replace(/\.md$/, "");
        // `/reference/...` is generated into the content tree at build time.
        if (docsPath.startsWith("/reference/")) continue;
        if (!docsPathResolves(docsPath)) broken.push(`${path}: ${raw}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("keeps the two entry-point skills present and named", () => {
    for (const slug of ["copilotkit", "copilotkit-cli"]) {
      const file = join(skillsDir, slug, "SKILL.md");
      expect(existsSync(file), `${slug}/SKILL.md`).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(`name: ${slug}`);
    }
  });

  it("keeps the entry points free of a transcribed API surface", () => {
    // A `sources.md` inventory marks a skill that copied source and therefore
    // needed its pointers audited. The entry points must never grow one again.
    // `copilotkit-channels` still carries one and is awaiting its own
    // disposition, so it is named here rather than silently tolerated.
    const inventories = files
      .filter(([p]) => p.endsWith("/sources.md"))
      .map(([p]) => p);
    expect(inventories).toEqual(["skills/copilotkit-channels/sources.md"]);
  });
});
