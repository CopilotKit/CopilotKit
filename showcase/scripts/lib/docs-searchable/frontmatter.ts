import matter from "gray-matter";
import yaml from "js-yaml";

/**
 * gray-matter, parsing YAML with js-yaml 4's `load`.
 *
 * gray-matter's built-in YAML engine calls js-yaml 3's `safeLoad`, which
 * js-yaml 4 removed. The pnpm workspace forces js-yaml >=4.1.1 on every
 * package (root `pnpm.overrides`), so under a workspace install the built-in
 * engine throws on every page and its frontmatter (`title`, `nav_title`,
 * `search`) is silently lost. Only the shell image's plain `npm install` gave
 * gray-matter the js-yaml 3 it expects. js-yaml 4's `load` is safe by default.
 */
export function parseFrontmatter(
  source: string,
): matter.GrayMatterFile<string> {
  return matter(source, {
    engines: { yaml: (input) => (yaml.load(input) ?? {}) as object },
  });
}
