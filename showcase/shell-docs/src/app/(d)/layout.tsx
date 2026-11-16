import { FrontendProvider } from "@/proto/frontend";
import { EXAMPLES } from "@/proto/examples";
import { ProtoLayout } from "@/proto/layout-client";
import { SiteHostsProvider } from "@/components/site-hosts";
import { getLiveNav } from "@/lib/live-nav";
import { withCatalogNav } from "@/lib/catalog-nav";
import { getSiteHosts } from "@/lib/runtime-config";

/** Prototype D is the site: its home at `/`, its docs under it. */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <SiteHostsProvider hosts={getSiteHosts()}>
      <FrontendProvider>
        <ProtoLayout
          variant="d"
          liveNav={withCatalogNav(getLiveNav())}
          // Just the ids: the catalog itself ships only with /examples.
          examples={EXAMPLES.map((e) => e.id)}
        >
          {children}
        </ProtoLayout>
      </FrontendProvider>
    </SiteHostsProvider>
  );
}
