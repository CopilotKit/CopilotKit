"use client";

import { useState, useEffect } from "react";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import Separator from "../ui/sidebar/separator";
import Page from "../ui/sidebar/page";
import Folder from "../ui/sidebar/folder";
import IntegrationLink from "../ui/sidebar/integration-link";
import IntegrationSelector, {
  Integration,
} from "../ui/integrations-sidebar/integration-selector";
import { OpenedFoldersProvider } from "@/lib/hooks/use-opened-folders";
import { INTEGRATION_ORDER } from "@/lib/integrations";

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string;
  index?: { url: string };
};

const NODE_COMPONENTS = {
  separator: Separator,
  page: Page,
  folder: Folder,
  integrationLink: IntegrationLink,
};

const isIntegrationFolder = (node: Node): boolean => {
  if (node.type !== "folder") return false;
  const url = node.index?.url || node.url;
  if (!url) return false;
  // Integration landing pages are at /{integration} (e.g., /langgraph)
  // Check if the URL matches a known integration ID
  const integrationId = url.replace(/^\//, "").split("/")[0];
  return INTEGRATION_ORDER.includes(
    integrationId as (typeof INTEGRATION_ORDER)[number],
  );
};

const Sidebar = ({
  pageTree,
  showIntegrationSelector = true,
}: {
  pageTree: DocsLayoutProps["tree"];
  showIntegrationSelector?: boolean;
}) => {
  const pages = pageTree.children;
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null);

  // Dispatch pageTree update for OpenedFoldersProvider
  useEffect(() => {
    if (pages.length > 0) {
      const event = new CustomEvent("pageTreeUpdate", { detail: pages });
      window.dispatchEvent(event);
    }
  }, [pages]);

  return (
    <OpenedFoldersProvider>
      <aside
        id="nd-sidebar"
        className={`w-full max-w-[260px] h-full border backdrop-blur-lg border-r-0 border-border rounded-l-2xl pl-3 ${showIntegrationSelector ? "pr-3" : "pr-1"} flex flex-col`}
        style={{ backgroundColor: "var(--sidebar)" }}
      >
        {showIntegrationSelector && (
          <IntegrationSelector
            selectedIntegration={selectedIntegration}
            setSelectedIntegration={setSelectedIntegration}
          />
        )}

        <ul
          className={`flex overflow-y-auto flex-col pr-1 max-h-full custom-scrollbar ${!showIntegrationSelector ? "pt-6" : ""}`}
        >
          <li className="w-full h-6" />
          {pages.map((page, index) => {
            const nodeType = isIntegrationFolder(page as Node)
              ? "integrationLink"
              : page.type;
            const Component = NODE_COMPONENTS[nodeType];
            // Use stable key based on page data to avoid hydration mismatches
            const pageUrl =
              (page as Node).index?.url ||
              (page as Node).url ||
              `page-${index}`;
            const key = `${nodeType}-${pageUrl}`;
            return <Component key={key} node={page as Node} />;
          })}
        </ul>
      </aside>
    </OpenedFoldersProvider>
  );
};

export default Sidebar;
