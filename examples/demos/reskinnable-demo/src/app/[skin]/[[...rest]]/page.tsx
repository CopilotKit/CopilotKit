"use client";
// This file is a dynamic router: it renders the page component the active
// skin resolves from the URL segments. `resolvePage` returns EXISTING page
// components (defined at module level in each skin), not components created
// during render — so react-hooks/static-components is a false positive here.
/* eslint-disable react-hooks/static-components */
import { use } from "react";
import { notFound } from "next/navigation";
import { getSkin } from "@/shell/registry";

export default function SkinPage({
  params,
}: {
  params: Promise<{ skin: string; rest?: string[] }>;
}) {
  const { skin: skinId, rest } = use(params);
  const skin = getSkin(skinId);
  if (!skin) notFound();
  const Page = skin.resolvePage(rest ?? []);
  if (!Page) notFound();
  return <Page />;
}
