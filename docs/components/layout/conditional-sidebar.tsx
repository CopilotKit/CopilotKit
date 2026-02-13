"use client";

import { usePathname } from "next/navigation";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import Sidebar from "./sidebar";
import IntegrationsSidebar from "./integrations-sidebar";
import { INTEGRATION_ORDER } from "@/lib/integrations";
import { normalizeUrl } from "@/lib/analytics-utils";
import { useMemo } from "react";

interface ConditionalSidebarProps {
  pageTree: DocsLayoutProps["tree"];
}

type Node = DocsLayoutProps["tree"]["children"][number];

export default function ConditionalSidebar({
  pageTree,
}: ConditionalSidebarProps) {
  const pathname = usePathname();

  // Normalize the pathname to handle /integrations/... paths
  const normalizedPathname = normalizeUrl(pathname);
  // Check if this is an integration landing page (e.g., /langgraph)
  // Use the first segment of the normalized pathname to ensure correct matching
  const firstSegment = normalizedPathname.replace(/^\//, "").split("/")[0];
  const isIntegrationRoute = INTEGRATION_ORDER.includes(
    firstSegment as (typeof INTEGRATION_ORDER)[number],
  );

  // Check if this is a reference route (e.g., /reference)
  const isReferenceRoute = firstSegment === "reference";

  // Find the reference folder and create a filtered pageTree
  const referencePageTree = useMemo(() => {
    if (!isReferenceRoute) return null;

    // Find the reference folder
    const referenceFolder = pageTree.children.find((node) => {
      if (node.type !== "folder") return false;
      const folderNode = node as any;
      const url = folderNode.index?.url || folderNode.url;
      const name =
        typeof folderNode.name === "string" ? folderNode.name : undefined;
      return url === "/reference" || name?.toLowerCase() === "reference";
    }) as Node | undefined;

    if (referenceFolder && "children" in referenceFolder) {
      // Return a pageTree with only the reference folder's children
      return {
        ...pageTree,
        children: (referenceFolder as any).children || [],
      };
    }

    return null;
  }, [isReferenceRoute, pageTree]);

  if (isIntegrationRoute) {
    return <IntegrationsSidebar pageTree={pageTree} />;
  }

  if (isReferenceRoute && referencePageTree) {
    return (
      <Sidebar pageTree={referencePageTree} showIntegrationSelector={false} />
    );
  }

  return <Sidebar pageTree={pageTree} />;
}
