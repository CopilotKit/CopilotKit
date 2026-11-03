import { FrontendProvider } from "@/proto/frontend";
import { ProtoLayout } from "@/proto/layout-client";
import { getLiveNav } from "@/lib/live-nav";
import { withCatalogNav } from "@/lib/catalog-nav";

/** Prototype D is the site: its home at `/`, its docs under it. */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <FrontendProvider>
      <ProtoLayout variant="d" liveNav={withCatalogNav(getLiveNav())}>
        {children}
      </ProtoLayout>
    </FrontendProvider>
  );
}
