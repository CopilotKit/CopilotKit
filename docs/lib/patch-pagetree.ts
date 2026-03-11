import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { INTEGRATION_METADATA } from "./integrations";

type Node = DocsLayoutProps["tree"]["children"][number];

/**
 * Special mappings for folder names that don't exactly match integration labels.
 * Key: folder name from meta.json title
 * Value: integration ID
 */
const FOLDER_NAME_TO_INTEGRATION_ID: Record<string, string> = {
  AutoGen2: "ag2",
  autogen2: "ag2",
};

/**
 * Patches the pageTree to set missing indexUrl for integration folders.
 * This fixes an issue where fumadocs v16 doesn't set indexUrl for root folders
 * even when they have index.mdx files and "root": true in meta.json.
 *
 * The patch works by:
 * 1. Finding folders without indexUrl
 * 2. Matching them to integration metadata by name (with special case handling)
 * 3. Setting the indexUrl from the integration's href
 */
export function patchPageTree(
  pageTree: DocsLayoutProps["tree"],
): DocsLayoutProps["tree"] {
  const patched = { ...pageTree };

  function patchNode(node: Node): Node {
    const patchedNode = { ...node } as any;

    // If this is a folder without an indexUrl, try to set it
    if (patchedNode.type === "folder" && !patchedNode.index?.url) {
      let integrationId: string | undefined;

      // First, check special mappings (e.g., "AutoGen2" -> "ag2")
      const folderName =
        typeof patchedNode.name === "string" ? patchedNode.name : undefined;
      if (folderName) {
        integrationId =
          FOLDER_NAME_TO_INTEGRATION_ID[folderName] ||
          FOLDER_NAME_TO_INTEGRATION_ID[folderName.toLowerCase()];
      }

      // If no special mapping, try to match by integration metadata (by folder name)
      if (!integrationId && folderName) {
        integrationId = Object.keys(INTEGRATION_METADATA).find((id) => {
          const meta =
            INTEGRATION_METADATA[id as keyof typeof INTEGRATION_METADATA];
          const folderNameLower = folderName.toLowerCase();
          const labelLower = meta.label.toLowerCase();
          const idLower = id.toLowerCase();
          return folderNameLower === labelLower || folderNameLower === idLower;
        });
      }

      if (integrationId) {
        const meta =
          INTEGRATION_METADATA[
            integrationId as keyof typeof INTEGRATION_METADATA
          ];
        // Type assertion needed because fumadocs expects a full Item type, but we only need to set the URL
        patchedNode.index = { url: meta.href } as any;
      } else {
        // If no integration match, check if folder has exactly one child page
        // In that case, set the indexUrl to that child's URL
        const children = patchedNode.children || [];
        const pageChildren = children.filter(
          (child: any) => child.type === "page",
        );

        if (pageChildren.length === 1) {
          const singlePage = pageChildren[0] as any;
          const pageUrl = singlePage.url;
          if (pageUrl) {
            patchedNode.index = { url: pageUrl } as any;
          }
        }
      }
    }

    // Recursively patch children
    if (patchedNode.children) {
      patchedNode.children = patchedNode.children.map(patchNode);
    }

    return patchedNode;
  }

  patched.children = patched.children.map(patchNode) as any;

  return patched;
}
