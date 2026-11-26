"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { Card } from "fumadocs-ui/components/card";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { useLivePages } from "./live-pages-context";
import { stackPage } from "./stack-href";

// Links on pages that aren't per stack (the cookbook, the reference) to pages
// that are (`/quickstart`): once the reader has a stack, they open its version
// of the page when it has one. Otherwise, and in the server render, the link
// stays as written.

interface Target {
  href: string;
  /** The page's slug and `?query#hash`, from `unscopedStackLink`. */
  slug: string;
  suffix: string;
}

function useReaderStackHref({ href, slug, suffix }: Target) {
  const { frontend, chosen } = useFrontend();
  const [framework] = useLastFramework();
  const pages = useLivePages();
  if (!chosen) return href;
  const to = stackPage(frontend, framework, slug, pages);
  return to ? `${to}${suffix}` : href;
}

export function ReaderStackLink({
  href,
  slug,
  suffix,
  ...props
}: Target & Omit<ComponentProps<typeof Link>, "href">) {
  return <Link href={useReaderStackHref({ href, slug, suffix })} {...props} />;
}

export function ReaderStackCard({
  href,
  slug,
  suffix,
  ...props
}: Target & Omit<ComponentProps<typeof Card>, "href">) {
  return <Card href={useReaderStackHref({ href, slug, suffix })} {...props} />;
}
