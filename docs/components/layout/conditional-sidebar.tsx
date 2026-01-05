"use client"

import { usePathname } from "next/navigation"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import Sidebar from "./sidebar"
import IntegrationsSidebar from "./integrations-sidebar"
import { INTEGRATION_ORDER } from "@/lib/integrations"
import { useMemo } from "react"

interface ConditionalSidebarProps {
  pageTree: DocsLayoutProps["tree"]
}

type Node = DocsLayoutProps['tree']['children'][number] & {
  url?: string;
  name?: string;
  index?: { url: string };
  children?: Node[];
};

export default function ConditionalSidebar({ pageTree }: ConditionalSidebarProps) {
  const pathname = usePathname()
  
  // Check if this is an integration landing page (e.g., /langgraph)
  const firstSegment = pathname.replace(/^\//, "").split("/")[0]
  const isIntegrationRoute = INTEGRATION_ORDER.includes(firstSegment as typeof INTEGRATION_ORDER[number])
  
  // Check if this is a reference route (e.g., /reference)
  const isReferenceRoute = firstSegment === "reference"
  
  // Find the reference folder and create a filtered pageTree
  const referencePageTree = useMemo(() => {
    if (!isReferenceRoute) return null;
    
    // Find the reference folder
    const referenceFolder = pageTree.children.find((node: Node) => {
      if (node.type !== 'folder') return false;
      const url = (node as Node).index?.url || (node as Node).url;
      return url === '/reference' || (node as Node).name?.toLowerCase() === 'reference';
    }) as Node | undefined;
    
    if (referenceFolder) {
      // Return a pageTree with only the reference folder's children
      return {
        ...pageTree,
        children: referenceFolder.children || []
      };
    }
    
    return null;
  }, [isReferenceRoute, pageTree]);
  
  if (isIntegrationRoute) {
    return <IntegrationsSidebar pageTree={pageTree} />
  }
  
  if (isReferenceRoute && referencePageTree) {
    return <Sidebar pageTree={referencePageTree} />
  }
  
  return <Sidebar pageTree={pageTree} />
}
