import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProtoArticle } from "@/proto/content";
import { isVariant, parseLocation } from "@/proto/routes";
import { variantMeta } from "@/proto/meta";

export default async function Page({
  params,
}: PageProps<"/proto/[variant]/[[...path]]">) {
  const { variant, path = [] } = await params;
  if (!isVariant(variant)) notFound();
  const loc = parseLocation(variant, path);
  if (!loc) notFound();
  return <ProtoArticle variant={variant} loc={loc} />;
}

export async function generateMetadata({
  params,
}: PageProps<"/proto/[variant]/[[...path]]">): Promise<Metadata> {
  const { variant } = await params;
  if (!isVariant(variant)) return {};
  return {
    title: `Prototype ${variant.toUpperCase()}: ${variantMeta(variant).name}`,
    robots: { index: false },
  };
}
