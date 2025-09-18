import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { TopNav } from "@/components/layout/top-nav";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      searchToggle={{ enabled: false }}
      sidebar={{
        tabs: false,
        banner: null,
      }}
      {...baseOptions}
    >
      <TopNav />
      {children}
    </DocsLayout>
  );
}
