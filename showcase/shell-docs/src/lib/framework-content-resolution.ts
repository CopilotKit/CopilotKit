import { loadDoc } from "./docs-render";
import { getDocsFolder, getDocsMode } from "./registry";

/**
 * Resolve the MDX source for a framework-scoped docs URL.
 *
 * This is deliberately shared by the HTML page and the `.md` / `.mdx`
 * endpoint. Keeping the candidate order here prevents raw Markdown from
 * silently choosing a different framework override than the page a reader
 * sees. The caller still owns route-only behavior such as framework landing
 * pages and the "not available" shell.
 */
export function resolveFrameworkContent(
  framework: string,
  slugPath: string,
): {
  contentSlugPath: string;
  doc: NonNullable<ReturnType<typeof loadDoc>>;
} | null {
  const docsMode = getDocsMode(framework);
  if (docsMode === "hidden") return null;

  const docsFolder = getDocsFolder(framework);
  const frameworkSlugPath = `integrations/${docsFolder}/${slugPath}`;
  const rootSlugPath = slugPath;

  // Authored integrations own their pages. Generated integrations use root
  // content by default, except these root routing shims which intentionally
  // resolve to a framework-specific guide when it exists.
  const frameworkFirst =
    docsMode === "authored" ||
    slugPath === "quickstart" ||
    slugPath === "threads-import";
  const candidates = frameworkFirst
    ? [frameworkSlugPath, rootSlugPath]
    : [rootSlugPath, frameworkSlugPath];

  // The raw-Markdown resolver asks for `index` when a framework path has no
  // tail. The HTML route renders its landing page separately, but Markdown
  // should still expose that framework's quickstart when it has no index.mdx.
  if (slugPath === "index") {
    candidates.push(`integrations/${docsFolder}/quickstart`);
  }

  for (const candidate of new Set(candidates)) {
    const doc = loadDoc(candidate);
    if (doc) return { contentSlugPath: candidate, doc };
  }
  return null;
}
