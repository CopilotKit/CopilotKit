import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import type { ReactNode } from "react"
import { baseOptions } from "../layout.config"
import { source } from "@/app/source"
import Sidebar from "@/components/layout/sidebar"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions}>
      <DocsLayout
        tree={source.pageTree}
        searchToggle={{ enabled: false }}
        nav={{ enabled: false }}
        sidebar={{ component: <Sidebar pageTree={source.pageTree} /> }}
      >
        {children}
      </DocsLayout>
    </HomeLayout>
  )
}
