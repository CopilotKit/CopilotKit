"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import { usePathname } from "next/navigation";
import { normalizeUrlForMatching } from "@/lib/analytics-utils";

interface OpenedFoldersContextType {
  openedFolderIds: Set<string>;
  toggleFolder: (folderId: string) => void;
  isFolderOpen: (folderId: string) => boolean;
}

const OpenedFoldersContext = createContext<
  OpenedFoldersContextType | undefined
>(undefined);

type TreeNode = {
  type: string;
  url?: string;
  $id?: string;
  children?: TreeNode[];
  index?: { url: string };
};

/**
 * Recursively find folder IDs that contain the current page
 */
function findParentFolderIds(
  nodes: TreeNode[] | undefined,
  pathname: string,
  parentIds: string[] = [],
): string[] {
  if (!nodes) return [];

  const normalizedPathname = normalizeUrlForMatching(pathname);
  const folderIdsToOpen: string[] = [];

  for (const node of nodes) {
    if (node.type === "folder" && node.$id) {
      const currentPath = [...parentIds, node.$id];

      // Check if this folder contains the current page
      const containsCurrentPage = checkFolderContainsPage(
        node,
        normalizedPathname,
      );

      if (containsCurrentPage) {
        // Add all parent folder IDs in the path to this folder
        folderIdsToOpen.push(...currentPath);
      }

      // Recursively check children
      if (node.children) {
        const childResults = findParentFolderIds(
          node.children,
          pathname,
          currentPath,
        );
        folderIdsToOpen.push(...childResults);
      }
    } else if (node.children) {
      // Non-folder node with children (shouldn't happen, but handle it)
      const childResults = findParentFolderIds(
        node.children,
        pathname,
        parentIds,
      );
      folderIdsToOpen.push(...childResults);
    }
  }

  return folderIdsToOpen;
}

/**
 * Check if a folder or any of its descendants contains the current page
 */
function checkFolderContainsPage(
  folder: TreeNode,
  normalizedPathname: string,
): boolean {
  // Check direct children
  if (folder.children) {
    for (const child of folder.children) {
      if (child.type === "page" && child.url) {
        const childUrl = normalizeUrlForMatching(child.url);
        if (
          normalizedPathname === childUrl ||
          normalizedPathname.startsWith(childUrl + "/")
        ) {
          return true;
        }
      } else if (child.type === "folder") {
        // Recursively check nested folders
        if (checkFolderContainsPage(child, normalizedPathname)) {
          return true;
        }
      }
    }
  }

  return false;
}

export const OpenedFoldersProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const pathname = usePathname();
  const [openedFolderIds, setOpenedFolderIds] = useState<Set<string>>(
    new Set(),
  );
  const [pageTree, setPageTree] = useState<TreeNode[] | null>(null);

  // Expose a way for consumers to register the page tree
  useEffect(() => {
    const handleTreeUpdate = ((event: CustomEvent) => {
      setPageTree(event.detail);
    }) as EventListener;

    window.addEventListener("pageTreeUpdate", handleTreeUpdate);
    return () => window.removeEventListener("pageTreeUpdate", handleTreeUpdate);
  }, []);

  // Auto-expand folders based on current pathname
  useEffect(() => {
    if (!pageTree || !pathname) return;

    const folderIdsToOpen = findParentFolderIds(pageTree, pathname);

    if (folderIdsToOpen.length > 0) {
      setOpenedFolderIds((prev) => {
        const newSet = new Set(prev);
        folderIdsToOpen.forEach((id) => newSet.add(id));
        return newSet;
      });
    }
  }, [pathname, pageTree]);

  const toggleFolder = useCallback((folderId: string) => {
    setOpenedFolderIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  }, []);

  const isFolderOpen = useCallback(
    (folderId: string) => {
      return openedFolderIds.has(folderId);
    },
    [openedFolderIds],
  );

  return (
    <OpenedFoldersContext.Provider
      value={{ openedFolderIds, toggleFolder, isFolderOpen }}
    >
      {children}
    </OpenedFoldersContext.Provider>
  );
};

export const useOpenedFolders = () => {
  const context = useContext(OpenedFoldersContext);
  if (context === undefined) {
    throw new Error(
      "useOpenedFolders must be used within an OpenedFoldersProvider",
    );
  }
  return context;
};
