"use client";

import Link from "fumadocs-core/link";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { normalizeUrl, normalizeUrlForMatching } from "@/lib/analytics-utils";

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string };

interface PageProps {
  node: Node;
  onNavigate?: () => void;
  minimal?: boolean;
}

/**
 * Checks if a page URL matches the current pathname.
 * Handles:
 * - Exact matches
 * - Index page matches (e.g., /langgraph matches /langgraph/index)
 * - Rewrite matches (e.g., /langgraph matches /integrations/langgraph)
 * - Normalizes relative URLs and integration URLs
 */
function isPageActive(pageUrl: string, pathname: string): boolean {
  const normalizedPageUrl = normalizeUrlForMatching(pageUrl);
  const normalizedPathname = normalizeUrlForMatching(pathname);

  // Exact match
  if (normalizedPageUrl === normalizedPathname) {
    return true;
  }

  // Handle index pages: /langgraph should match /langgraph/index
  if (normalizedPathname === normalizedPageUrl.replace(/\/index$/, "")) {
    return true;
  }

  // Handle reverse: /langgraph/index should match /langgraph
  if (normalizedPageUrl === `${normalizedPathname}/index`) {
    return true;
  }

  // Handle rewrite patterns: /langgraph should match /integrations/langgraph
  // Extract the base path (e.g., /langgraph from /integrations/langgraph/index)
  const pathnameBase = normalizedPathname.replace(/^\/integrations\//, "/");
  const pageUrlBase = normalizedPageUrl.replace(/^\/integrations\//, "/");

  if (pathnameBase === pageUrlBase) {
    return true;
  }

  // Handle index with rewrite: /langgraph should match /integrations/langgraph/index
  if (pathnameBase === pageUrlBase.replace(/\/index$/, "")) {
    return true;
  }

  if (pageUrlBase === `${pathnameBase}/index`) {
    return true;
  }

  return false;
}

const Page = ({ node, onNavigate, minimal }: PageProps) => {
  const pathname = usePathname();
  const normalizedUrl = normalizeUrl(node.url);
  const isActive = isPageActive(node.url, pathname);

  return (
    <li
      className={cn(
        "flex justify-start items-center px-3 h-10 text-sm opacity-60 transition-all duration-300 shrink-0 hover:opacity-100 hover:bg-white dark:hover:bg-white/10 rounded-lg",
        isActive && "opacity-100 bg-white dark:bg-white/10",
      )}
    >
      <Link
        href={normalizedUrl}
        className="text-foreground dark:text-white"
        onClick={onNavigate}
      >
        {node.name}
      </Link>
    </li>
  );
};

export default Page;
