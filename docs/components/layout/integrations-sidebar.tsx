"use client";

import { useState, useMemo, useEffect } from "react";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import Separator from "../ui/sidebar/separator";
import Page from "../ui/sidebar/page";
import Folder from "../ui/sidebar/folder";
import IntegrationSelector, {
  Integration,
} from "../ui/integrations-sidebar/integration-selector";
import IntegrationSelectorSkeleton from "../ui/integrations-sidebar/skeleton";
import { OpenedFoldersProvider } from "@/lib/hooks/use-opened-folders";
import { INTEGRATION_METADATA } from "@/lib/integrations";

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string;
  name?: string;
  index?: { url: string };
  children?: Node[];
};

const NODE_COMPONENTS = {
  separator: Separator,
  page: Page,
  folder: Folder,
};

const IntegrationsSidebar = ({
  pageTree,
}: {
  pageTree: DocsLayoutProps["tree"];
}) => {
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null);

  const integrationPages = useMemo(() => {
    if (!selectedIntegration) return [];

    // Get the integration metadata to match by label
    const integrationMeta = INTEGRATION_METADATA[selectedIntegration];
    const integrationLabel = integrationMeta?.label;

    // Integration folders might have URLs at either:
    // - /{integration} (e.g., /langgraph) - landing page URL
    // - /integrations/{integration} - content folder URL
    const possiblePaths = [
      `/${selectedIntegration}`,
      `/integrations/${selectedIntegration}`,
    ];

    // Special mappings for folder names that don't match integration labels
    const FOLDER_NAME_MAPPINGS: Record<string, string> = {
      AutoGen2: "ag2",
      autogen2: "ag2",
    };

    // Helper to check if a folder matches the integration
    const matchesIntegration = (folderNode: Node): boolean => {
      if (folderNode.type !== "folder") return false;

      // First, try to match by URL
      const url = folderNode.index?.url || folderNode.url;
      if (url && possiblePaths.includes(url)) {
        return true;
      }

      // If no URL, try to match by folder name (case-insensitive)
      // Match both the integration label (e.g., "LangGraph") and the ID (e.g., "langgraph")
      if (folderNode.name) {
        const folderNameLower = folderNode.name.toLowerCase();
        const labelLower = integrationLabel?.toLowerCase() || "";
        const idLower = selectedIntegration.toLowerCase();

        // Check special mappings first (e.g., "AutoGen2" -> "ag2")
        const mappedId =
          FOLDER_NAME_MAPPINGS[folderNode.name] ||
          FOLDER_NAME_MAPPINGS[folderNameLower];
        if (mappedId && mappedId === selectedIntegration.toLowerCase()) {
          return true;
        }

        // Then check direct matches
        if (folderNameLower === labelLower || folderNameLower === idLower) {
          return true;
        }
      }

      return false;
    };

    // First, try to find at top level
    let integrationFolder = pageTree.children.find((node) =>
      matchesIntegration(node as Node),
    ) as Node | undefined;

    // If not found, look inside the "integrations" parent folder
    if (!integrationFolder) {
      const integrationsParent = pageTree.children.find((node) => {
        const folderNode = node as Node;
        return (
          folderNode.type === "folder" &&
          (folderNode.index?.url === "/integrations" ||
            folderNode.name?.toLowerCase() === "integrations")
        );
      }) as Node | undefined;

      if (integrationsParent?.children) {
        integrationFolder = integrationsParent.children.find((node) =>
          matchesIntegration(node as Node),
        ) as Node | undefined;
      }
    }

    return integrationFolder?.children ?? [];
  }, [selectedIntegration, pageTree.children]);

  // Dispatch pageTree update for OpenedFoldersProvider
  useEffect(() => {
    if (integrationPages.length > 0) {
      const event = new CustomEvent("pageTreeUpdate", {
        detail: integrationPages,
      });
      window.dispatchEvent(event);
    }
  }, [integrationPages]);

  return (
    <OpenedFoldersProvider>
      <aside
        id="nd-sidebar"
        className="w-full flex-col max-w-[260px] h-full border backdrop-blur-lg border-r-0 border-border bg-glass-background rounded-l-2xl pl-3 pr-3 flex"
      >
        <IntegrationSelector
          selectedIntegration={selectedIntegration}
          setSelectedIntegration={setSelectedIntegration}
        />

        {selectedIntegration ? (
          <ul className="flex overflow-y-auto flex-col pr-1 max-h-full custom-scrollbar">
            <li className="w-full h-6" />
            {integrationPages.map((page, index) => {
              const Component = NODE_COMPONENTS[page.type];
              const pageUrl = page.index?.url || page.url || `page-${index}`;
              const key = `${page.type}-${pageUrl}`;
              return <Component key={key} node={page as Node} />;
            })}
          </ul>
        ) : (
          <IntegrationSelectorSkeleton />
        )}
      </aside>
    </OpenedFoldersProvider>
  );
};

export default IntegrationsSidebar;
