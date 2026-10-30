import "../site.css";
import { SiteHeader } from "@/components/site/site-header";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { STANDARD_NAMES } from "@/components/docs/standard-index";

export const metadata = {
  title: "Components | A2UI Playground",
  description:
    "The A2UI 1.0 catalog: the 69 Gen UI 2.0 standard components, plus 52 of the playground's own on shadcn/ui, TanStack Charts and MapLibre, and 3 macros.",
};

export default function ComponentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="components" />
      <div className="site-container flex gap-10">
        <DocsSidebar standard={STANDARD_NAMES} />
        <main className="min-w-0 flex-1 pb-24 pt-8">{children}</main>
      </div>
    </div>
  );
}
