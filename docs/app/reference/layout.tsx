import { DocsLayout } from "fumadocs-ui/layout";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { TopBar } from "@/components/layout/top-bar";

export default function Layout({ children }: { children: ReactNode }) {
  
  return (
    <>
      <TopBar />
      <div className="pt-0"> {/* Remove extra padding at the top */}
        <DocsLayout
          tree={source.pageTree}
          {...baseOptions}
          sidebar={{
            hideSearch: true
          }}
        >
          {children}
        </DocsLayout>
      </div>
    </>
  );
}
