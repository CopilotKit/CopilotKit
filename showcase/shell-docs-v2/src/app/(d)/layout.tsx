import { FrontendProvider } from "@/proto/frontend";
import { ProtoLayout } from "@/proto/layout-client";
import { getLiveNav } from "@/lib/live-nav";

/** Prototype D is the site: its home at `/`, its docs under it. */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <FrontendProvider>
      <ProtoLayout variant="d" liveNav={getLiveNav()}>
        {children}
      </ProtoLayout>
    </FrontendProvider>
  );
}
