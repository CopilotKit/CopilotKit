import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import type { ReactNode } from "react"
import { baseOptions } from "../layout.config"
import { source } from "@/app/source"
import IntegrationsSidebar from "@/components/layout/integrations-sidebar"
import Navbar from "@/components/layout/navbar"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar pageTree={source.pageTree} />
      <HomeLayout {...{ ...baseOptions, nav: { enabled: false } }}>
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
    </>
  )
}
