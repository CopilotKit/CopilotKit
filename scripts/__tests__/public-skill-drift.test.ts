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

/**
 * The procedure skills rot differently from the two entry points.
 *
 * `copilotkit` and `copilotkit-cli` point at documentation, so their failure
 * mode is a dead docs path — guarded above. The Inspector and Intelligence
 * skills instead name concrete repository facts: an Nx target, a dev-server
 * port, a lab scenario id, a landing-page source file, a Callout snippet.
 * Every one of those is a claim that can quietly stop being true, and when it
 * does the skill sends an agent somewhere that no longer exists.
 *
 * Only claims with an unambiguous ground truth are asserted. Which panes the
 * Inspector *ships* is deliberately not asserted: panes are not enumerated as
 * data anywhere in `packages/web-inspector`, whose entry point is one
 * fourteen-thousand-line module, so matching a pane label against source
 * proves nothing in either direction. A first draft of this suite tried it and
 * passed while the map really was wrong — "Pop-out window" is listed unshipped
 * although `src/lib/pop-out.ts` is imported by the package entry — which is
 * worse than not testing it, because a green run reads as confirmation.
 * Making that direction testable needs a pane registry in the package, not a
 * cleverer regex here.
 */
describe("procedure skills name repository facts that still hold", () => {
  /** Reads a skill file, or fails loudly rather than silently passing. */
  function skill(path: string): string {
    const full = resolve(skillsDir, path);
    if (!existsSync(full)) throw new Error(`missing skill file: ${path}`);
    return readFileSync(full, "utf8");
  }

  it("maps every Inspector pane to a Callout snippet that exists", () => {
    const map = skill("inspector-docs/references/pane-map.md");
    // Snippet cells name bare `open-inspector-*.mdx` files, all in one
    // directory. Anchored on that prefix so the `docs/…mdx` page references in
    // the surfaces table below are not mistaken for snippets.
    const named = [
      ...new Set(
        [...map.matchAll(/(?<![\w/-])(open-inspector-[a-z0-9-]*\.mdx)/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    expect(named.length).toBeGreaterThan(0);
    const dir = resolve(contentDir, "snippets/shared/inspector");
    expect(named.filter((f) => !existsSync(join(dir, f)))).toEqual([]);
  });

  it("maps every Inspector pane to docs pages that exist", () => {
    const map = skill("inspector-docs/references/pane-map.md");
    const pages = [
      ...new Set(
        [...map.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.mdx)`/g)].map((m) => m[1]),
      ),
    ];
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((f) => !existsSync(resolve(contentDir, f)))).toEqual(
      [],
    );
  });

  it("keeps the Intelligence landing sources it tells you to edit", () => {
    const md = skill("intelligence-docs/SKILL.md");
    const paths = [
      ...new Set(
        [...md.matchAll(/`(showcase\/shell-docs\/src\/[A-Za-z0-9_./-]+)`/g)]
          .map((m) => m[1])
          // Trailing-slash entries are directory prose, not editable files.
          .filter((f) => !f.endsWith("/")),
      ),
    ];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((f) => !existsSync(resolve(root, f)))).toEqual([]);
  });

  it("names an Inspector workbench target, port and scenario that exist", () => {
    const md = skill("inspector-workbench/SKILL.md");
    const project = JSON.parse(
      readFileSync(
        resolve(root, "packages/web-inspector/project.json"),
        "utf8",
      ),
    ) as { targets?: Record<string, unknown> };

    // The Nx target the skill tells the agent to run.
    const target = md.match(/nx run @copilotkit\/web-inspector:([\w:-]+)/)?.[1];
    expect(target, "skill names an nx target").toBeDefined();
    expect(Object.keys(project.targets ?? {})).toContain(target);

    // The port it tells the agent to open, which that target has to pin.
    const port = md.match(/127\.0\.0\.1:(\d+)/)?.[1];
    expect(port, "skill names a port").toBeDefined();
    expect(JSON.stringify(project.targets?.[target as string])).toContain(
      `--port ${port}`,
    );

    // The lab scenarios and query keys it tells the agent to load.
    const lab = readFileSync(
      resolve(root, "packages/web-inspector/dev/threads-state-lab.ts"),
      "utf8",
    );
    const scenarios = [
      ...new Set(
        [...md.matchAll(/[?&]scenario=([a-z0-9-]+)/g)].map((m) => m[1]),
      ),
    ];
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.filter((s) => !lab.includes(s))).toEqual([]);
    for (const key of [
      ...new Set([...md.matchAll(/[?&]([a-z-]+)=1\b/g)].map((m) => m[1])),
    ]) {
      expect(lab, `lab supports ?${key}=`).toContain(key);
    }
  });
});
