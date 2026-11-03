import { notFound } from "next/navigation";
import { FrontendProvider } from "@/proto/frontend";
import { ProtoLayout } from "@/proto/layout-client";
import { isVariant } from "@/proto/routes";

export default async function Layout({
  params,
  children,
}: LayoutProps<"/proto/[variant]">) {
  const { variant } = await params;
  if (!isVariant(variant)) notFound();
  return (
    <FrontendProvider>
      <ProtoLayout variant={variant}>{children}</ProtoLayout>
    </FrontendProvider>
  );
}
