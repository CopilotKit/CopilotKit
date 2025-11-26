"use client"

import { useState } from "react"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import Separator from "../ui/sidebar/separator"
import Page from "../ui/sidebar/page"
import Folder from "../ui/sidebar/folder"
import IntegrationSelector, {
  Integration,
} from "../ui/integrations-sidebar/integration-selector"
import IntegrationSelectorSkeleton from "../ui/integrations-sidebar/skeleton"

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string }

const NODE_COMPONENTS = {
  separator: Separator,
  page: Page,
  folder: Folder,
}

const IntegrationsSidebar = ({
  pageTree,
}: {
  pageTree: DocsLayoutProps["tree"]
}) => {
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null)
  const pages = pageTree.children

  return (
    <aside
      id="nd-sidebar"
      className="w-full flex-col max-w-[260px] h-[calc(100vh-64px-8px)] lg:h-[calc(100vh-80px-8px)] border backdrop-blur-lg border-r-0 border-border bg-glass-background rounded-l-2xl pl-3 pr-3 hidden md:flex"
    >
      <IntegrationSelector
        selectedIntegration={selectedIntegration}
        setSelectedIntegration={setSelectedIntegration}
      />

      {selectedIntegration ? (
        <ul className="flex overflow-y-auto flex-col pr-1 max-h-full custom-scrollbar">
          <li className="w-full h-6" />
          {pages.map((page) => {
            const Component = NODE_COMPONENTS[page.type]
            return <Component key={crypto.randomUUID()} node={page as Node} />
          })}
        </ul>
      ) : (
        <IntegrationSelectorSkeleton />
      )}
    </aside>
  )
}

export default IntegrationsSidebar
