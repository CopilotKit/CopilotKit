"use client";

import { useCallback } from "react";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { usePathname, useRouter } from "next/navigation";
import Page from "./page";
import ChevronDownIcon from "../icons/chevron";
import { cn } from "@/lib/utils";
import Separator from "./separator";
import { useOpenedFolders } from "@/lib/hooks/use-opened-folders";
import { normalizeUrl, normalizeUrlForMatching } from "@/lib/analytics-utils";

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string;
  $id?: string;
};

interface FolderProps {
  node: Node & { index?: { url: string; $id?: string } };
  onNavigate?: () => void;
}

/**
 * Checks if a folder's index URL matches the current pathname.
 * Handles:
 * - Index page normalization (e.g., /langgraph matches /langgraph/index)
 * - Rewrite matches (e.g., /langgraph matches /integrations/langgraph)
 * - Normalizes integration URLs and relative URLs
 */
function isFolderActive(
  indexUrl: string | undefined,
  pathname: string,
): boolean {
  if (!indexUrl) return false;

  const normalizedIndexUrl = normalizeUrlForMatching(indexUrl);
  const normalizedPathname = normalizeUrlForMatching(pathname);

  // Exact match
  if (normalizedIndexUrl === normalizedPathname) {
    return true;
  }

  // Handle index pages: /langgraph should match /langgraph/index
  if (normalizedPathname === normalizedIndexUrl.replace(/\/index$/, "")) {
    return true;
  }

  // Handle reverse: /langgraph/index should match /langgraph
  if (normalizedIndexUrl === `${normalizedPathname}/index`) {
    return true;
  }

  // Handle rewrite patterns: /langgraph should match /integrations/langgraph
  const pathnameBase = normalizedPathname.replace(/^\/integrations\//, "/");
  const indexUrlBase = normalizedIndexUrl.replace(/^\/integrations\//, "/");

  if (pathnameBase === indexUrlBase) {
    return true;
  }

  // Handle index with rewrite: /langgraph should match /integrations/langgraph/index
  if (pathnameBase === indexUrlBase.replace(/\/index$/, "")) {
    return true;
  }

  if (indexUrlBase === `${pathnameBase}/index`) {
    return true;
  }

  return false;
}

const Folder = ({ node }: FolderProps) => {
  const { isFolderOpen, toggleFolder } = useOpenedFolders();
  const pathname = usePathname();
  const router = useRouter();
  const folderUrl = node.index?.url;
  const folderId = node.$id;

  // Check if folder should be open by default from meta.json defaultOpen property
  // Fumadocs exposes this property from meta.json files
  const defaultOpen = (node as any).defaultOpen === true;

  const isOpen = folderId ? isFolderOpen(folderId) || defaultOpen : false;

  // Check if any child page is active - if so, don't mark the folder as active
  const folderChildren = (node as { children?: Node[] }).children || [];
  const normalizedPathname = normalizeUrlForMatching(pathname);
  const hasActiveChild = folderChildren.some((child: any) => {
    if (child.type === "page" && child.url) {
      const childUrl = normalizeUrlForMatching(child.url);
      return (
        normalizedPathname === childUrl ||
        normalizedPathname.startsWith(childUrl + "/")
      );
    }
    return false;
  });

  // Only mark folder as active if we're on the folder's index page AND no child is active
  const isActive =
    !hasActiveChild && isFolderActive(node?.index?.url, pathname);

  const NODE_COMPONENTS = {
    separator: Separator,
    page: Page,
    folder: Folder,
  };

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (folderId) {
        toggleFolder(folderId);
      }

      if (folderUrl) {
        const normalizedUrl = normalizeUrl(folderUrl);
        router.push(normalizedUrl);
      }
    },
    [folderUrl, router, folderId, toggleFolder],
  );

  return (
    <div className="w-full">
      <li
        className={cn(
          "w-full shrink-0 opacity-60 transition-all duration-300 hover:opacity-100 hover:bg-white dark:hover:bg-white/10 rounded-lg",
          isActive && "opacity-100 bg-white dark:bg-white/10",
        )}
      >
        <button
          type="button"
          onClick={handleLinkClick}
          className="flex gap-2 justify-between items-center px-3 w-full h-10 cursor-pointer"
        >
          <span className="w-max text-sm shrink-0">{node.name}</span>
          <ChevronDownIcon className={cn(isOpen ? "rotate-180" : "")} />
        </button>
      </li>
      {isOpen && (
        <ul className="flex relative flex-col gap-2 ml-4">
          <div className="absolute top-1/2 -translate-y-1/2 -left-2 w-px h-[calc(100%-8px)] bg-foreground/10" />

          {(node as { children: Node[] }).children.map((page, index) => {
            const Component =
              NODE_COMPONENTS[page.type as keyof typeof NODE_COMPONENTS];
            const pageWithIndex = page as Node & { index?: { url: string } };
            const pageUrl =
              pageWithIndex.index?.url || page.url || `page-${index}`;
            const key = `${page.type}-${pageUrl}`;
            return <Component key={key} node={page as Node} minimal={true} />;
          })}
        </ul>
      )}
    </div>
  );
};

export default Folder;
