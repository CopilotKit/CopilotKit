import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import ConditionalSidebar from "@/components/layout/conditional-sidebar";
import Navbar from "@/components/layout/navbar";
import { ScrollReset } from "@/components/layout/scroll-reset";
import { patchPageTree } from "@/lib/patch-pagetree";

export default function Layout({ children }: { children: ReactNode }) {
  const patchedPageTree = patchPageTree(source.pageTree);

  return (
    <>
      <Navbar pageTree={patchedPageTree} />
      <HomeLayout {...baseOptions} nav={{ enabled: false }}>
        <ConditionalSidebar pageTree={patchedPageTree} />
        <div className="docs-content-wrapper">
          <ScrollReset />
          <DocsLayout
            tree={patchedPageTree}
            searchToggle={{ enabled: false }}
            nav={{ enabled: false }}
            sidebar={{ enabled: false }}
          >
            {children}
          </DocsLayout>
        </div>
      </HomeLayout>
    </>
  );
}
