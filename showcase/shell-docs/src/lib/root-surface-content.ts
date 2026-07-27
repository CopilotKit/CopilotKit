import { loadDoc } from "./docs-render";
import { getDocsFolder, getDocsMode, ROOT_FRAMEWORK } from "./registry";

type RootSurfaceContentDependencies = {
  getDocsFolder: typeof getDocsFolder;
  getDocsMode: typeof getDocsMode;
  loadDoc: typeof loadDoc;
};

export type RootSurfaceContentResolution = {
  contentSlugPath?: string;
  frameworkOverride?: string;
};

const defaultDependencies: RootSurfaceContentDependencies = {
  getDocsFolder,
  getDocsMode,
  loadDoc,
};

/**
 * Resolve content for the bare root docs surface without changing its public
 * URL. Authored Built-in Agent content wins; otherwise the root document is
 * used, with Built-in Agent snippet defaults only when the page declares a
 * snippet cell.
 */
export function resolveRootSurfaceContent(
  slugPath: string,
  dependencies: RootSurfaceContentDependencies = defaultDependencies,
): RootSurfaceContentResolution | null {
  const docsFolder = dependencies.getDocsFolder(ROOT_FRAMEWORK);
  const overridePath = `integrations/${docsFolder}/${slugPath}`;

  if (
    dependencies.getDocsMode(ROOT_FRAMEWORK) === "authored" &&
    dependencies.loadDoc(overridePath)
  ) {
    return {
      contentSlugPath: overridePath,
      frameworkOverride: ROOT_FRAMEWORK,
    };
  }

  const doc = dependencies.loadDoc(slugPath);
  if (!doc) return null;

  return {
    frameworkOverride: doc.fm.defaultCell ? ROOT_FRAMEWORK : undefined,
  };
}
