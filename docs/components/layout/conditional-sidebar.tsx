"use client"

import { usePathname } from "next/navigation"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import Sidebar from "./sidebar"
import IntegrationsSidebar from "./integrations-sidebar"
import { INTEGRATION_ORDER } from "@/lib/integrations"

interface ConditionalSidebarProps {
  pageTree: DocsLayoutProps["tree"]
}

export default function ConditionalSidebar({ pageTree }: ConditionalSidebarProps) {
  const pathname = usePathname()
  
  // Check if this is an integration landing page (e.g., /langgraph)
  const firstSegment = pathname.replace(/^\//, "").split("/")[0]
  const isIntegrationRoute = INTEGRATION_ORDER.includes(firstSegment as typeof INTEGRATION_ORDER[number])
  
  // Debug logging
  console.log('ConditionalSidebar - pathname:', pathname);
  console.log('ConditionalSidebar - firstSegment:', firstSegment);
  console.log('ConditionalSidebar - isIntegrationRoute:', isIntegrationRoute);
  
  if (isIntegrationRoute) {
    return <IntegrationsSidebar pageTree={pageTree} />
  }
  
  return <Sidebar pageTree={pageTree} />
}
