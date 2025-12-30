import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import type { ReactNode } from "react"
import { baseOptions } from "../layout.config"
import { source } from "@/app/source"
import IntegrationsSidebar from "@/components/layout/integrations-sidebar"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions}>
      <DocsLayout
        tree={source.pageTree}
        searchToggle={{ enabled: false }}
        nav={{ enabled: false }}
        sidebar={{
          component: <IntegrationsSidebar pageTree={source.pageTree} />,
        }}
      >
        {children}
      </DocsLayout>
    </HomeLayout>
  )
}
