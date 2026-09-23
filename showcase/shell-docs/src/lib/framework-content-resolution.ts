import { docCandidateOrder, loadDoc } from "./docs-render";
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

  // Same order the page route and `llms-mdx` use (see docCandidateOrder):
  // authored integrations own their pages; generated integrations use root
  // content except for the framework-wins routing shims.
  const candidates = docCandidateOrder(docsMode, docsFolder, slugPath);

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
