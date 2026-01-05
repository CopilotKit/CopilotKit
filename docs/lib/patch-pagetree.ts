import { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import { INTEGRATION_METADATA } from './integrations';

type Node = DocsLayoutProps['tree']['children'][number] & {
  url?: string;
  name?: string;
  index?: { url: string };
  children?: Node[];
};

/**
 * Patches the pageTree to set missing indexUrl for integration folders.
 * This fixes an issue where fumadocs v16 doesn't set indexUrl for root folders
 * even when they have index.mdx files and "root": true in meta.json.
 * 
 * The patch works by:
 * 1. Finding folders without indexUrl
 * 2. Matching them to integration metadata by name
 * 3. Setting the indexUrl from the integration's href
 */
export function patchPageTree(pageTree: DocsLayoutProps['tree']): DocsLayoutProps['tree'] {
  const patched = { ...pageTree };
  
  function patchNode(node: Node): Node {
    const patchedNode = { ...node };
    
    // If this is a folder without an indexUrl, try to set it
    if (patchedNode.type === 'folder' && !patchedNode.index?.url) {
      // Try to match by integration metadata (by folder name)
      const integrationId = Object.keys(INTEGRATION_METADATA).find(id => {
        const meta = INTEGRATION_METADATA[id as keyof typeof INTEGRATION_METADATA];
        const folderNameLower = patchedNode.name?.toLowerCase() || '';
        const labelLower = meta.label.toLowerCase();
        const idLower = id.toLowerCase();
        return folderNameLower === labelLower || folderNameLower === idLower;
      });
      
      if (integrationId) {
        const meta = INTEGRATION_METADATA[integrationId as keyof typeof INTEGRATION_METADATA];
        patchedNode.index = { url: meta.href };
      }
    }
    
    // Recursively patch children
    if (patchedNode.children) {
      patchedNode.children = patchedNode.children.map(patchNode);
    }
    
    return patchedNode;
  }
  
  patched.children = patched.children.map(patchNode);
  
  return patched;
}
