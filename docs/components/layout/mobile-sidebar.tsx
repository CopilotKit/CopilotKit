"use client";

import Image from "next/image";
import Link from "fumadocs-core/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useEffect, useCallback } from "react";
// Components
import Separator from "@/components/ui/sidebar/separator";
import Page from "@/components/ui/sidebar/page";
import Folder from "@/components/ui/sidebar/folder";
import Dropdown from "@/components/ui/mobile-sidebar/dropdown";
import IntegrationSelector from "@/components/ui/integrations-sidebar/integration-selector";
import IntegrationSelectorSkeleton from "@/components/ui/integrations-sidebar/skeleton";
import { OpenedFoldersProvider } from "@/lib/hooks/use-opened-folders";
// Icons
import DiscordIcon from "@/components/ui/icons/discord";
import GithubIcon from "@/components/ui/icons/github";
import CrossIcon from "@/components/ui/icons/cross";
// Types
import { NavbarLink } from "./navbar";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { Integration } from "../ui/integrations-sidebar/integration-selector";
import { INTEGRATION_ORDER, INTEGRATION_METADATA } from "@/lib/integrations";
import { normalizeUrl } from "@/lib/analytics-utils";

interface MobileSidebarProps {
  pageTree: DocsLayoutProps["tree"];
  setIsOpen: (isOpen: boolean) => void;
  handleToggleTheme: () => void;
}

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string;
  name?: string;
  index?: { url: string };
  children?: Node[];
};

const LEFT_LINKS: NavbarLink[] = [
  {
    icon: <GithubIcon />,
    href: "https://github.com/copilotkit/copilotkit",
    target: "_blank",
  },
  {
    icon: <DiscordIcon />,
    href: "https://discord.gg/6dffbvGU3D",
    target: "_blank",
  },
];

const NODE_COMPONENTS: Record<
  Node["type"],
  React.ComponentType<{ node: Node; onNavigate?: () => void }>
> = {
  separator: Separator,
  page: Page,
  folder: Folder,
};

const ANIMATION_DURATION = 300; // ms

const MobileSidebar = ({
  pageTree,
  setIsOpen,
  handleToggleTheme,
}: MobileSidebarProps) => {
  const pathname = usePathname();
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Trigger slide-in animation on mount
  useEffect(() => {
    // Small delay to ensure the initial state is rendered before animating
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Handle closing with animation
  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      setIsOpen(false);
    }, ANIMATION_DURATION);
  }, [setIsOpen]);

  // Determine route type from pathname
  const normalizedPathname = normalizeUrl(pathname);
  const firstSegment = normalizedPathname.replace(/^\//, "").split("/")[0];
  const isIntegrationRoute = INTEGRATION_ORDER.includes(
    firstSegment as (typeof INTEGRATION_ORDER)[number],
  );
  const isReferenceRoute = firstSegment === "reference";

  // Get integration-specific pages when an integration is selected
  const integrationPages = useMemo(() => {
    if (!selectedIntegration) return [];

    const integrationMeta = INTEGRATION_METADATA[selectedIntegration];
    const integrationLabel = integrationMeta?.label;

    const possiblePaths = [
      `/${selectedIntegration}`,
      `/integrations/${selectedIntegration}`,
    ];

    const FOLDER_NAME_MAPPINGS: Record<string, string> = {
      AutoGen2: "ag2",
      autogen2: "ag2",
    };

    const matchesIntegration = (folderNode: Node): boolean => {
      if (folderNode.type !== "folder") return false;

      const url = folderNode.index?.url || folderNode.url;
      if (url && possiblePaths.includes(url)) {
        return true;
      }

      if (folderNode.name) {
        const folderNameLower = folderNode.name.toLowerCase();
        const labelLower = integrationLabel?.toLowerCase() || "";
        const idLower = selectedIntegration.toLowerCase();

        const mappedId =
          FOLDER_NAME_MAPPINGS[folderNode.name] ||
          FOLDER_NAME_MAPPINGS[folderNameLower];
        if (mappedId && mappedId === selectedIntegration.toLowerCase()) {
          return true;
        }

        if (folderNameLower === labelLower || folderNameLower === idLower) {
          return true;
        }
      }

      return false;
    };

    let integrationFolder = pageTree.children.find((node) =>
      matchesIntegration(node as Node),
    ) as Node | undefined;

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

  // Get reference-specific pages
  const referencePages = useMemo(() => {
    if (!isReferenceRoute) return [];

    const referenceFolder = pageTree.children.find((node) => {
      if (node.type !== "folder") return false;
      const folderNode = node as Node;
      const url = folderNode.index?.url || folderNode.url;
      const name =
        typeof folderNode.name === "string" ? folderNode.name : undefined;
      return url === "/reference" || name?.toLowerCase() === "reference";
    }) as Node | undefined;

    if (referenceFolder && "children" in referenceFolder) {
      return (referenceFolder as Node).children || [];
    }

    return [];
  }, [isReferenceRoute, pageTree.children]);

  // Determine which pages to show
  const pagesToShow = useMemo(() => {
    if (isIntegrationRoute && selectedIntegration) {
      return integrationPages;
    }
    if (isReferenceRoute) {
      return referencePages;
    }
    return pageTree.children;
  }, [
    isIntegrationRoute,
    selectedIntegration,
    integrationPages,
    isReferenceRoute,
    referencePages,
    pageTree.children,
  ]);

  return (
    <div
      className={`flex fixed top-0 left-0 z-50 justify-end p-1 w-full h-full transition-colors duration-300 ${
        isVisible ? "bg-black/30" : "bg-black/0"
      }`}
      onClick={(e) => {
        // Close when clicking the backdrop (outside the sidebar)
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <OpenedFoldersProvider>
        <aside
          className={`flex flex-col w-full max-w-[280px] h-[calc(100vh-8px)] border backdrop-blur-3xl border-r-0 border-border bg-white/50 dark:bg-white/[0.01] rounded-2xl pl-3 pr-1 transition-transform duration-300 ease-out ${
            isVisible ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex justify-between items-center my-2 w-full">
            <div className="flex gap-1 items-center">
              {LEFT_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  target={link.target}
                  className="flex justify-center items-center w-11 h-11 shrink-0"
                >
                  <span className="flex items-center h-full">{link.icon}</span>
                </Link>
              ))}
              <button
                className="flex justify-center items-center w-11 h-11 cursor-pointer"
                onClick={handleToggleTheme}
              >
                <Image
                  src="/images/navbar/theme-moon.svg"
                  alt="Theme icon"
                  width={20}
                  height={20}
                  className="hidden dark:inline-block"
                />
                <Image
                  src="/images/navbar/theme-sun.svg"
                  alt="Theme icon"
                  width={20}
                  height={20}
                  className="dark:hidden"
                />
              </button>
            </div>
            <button
              className="flex justify-center items-center w-11 h-full cursor-pointer"
              onClick={handleClose}
            >
              <CrossIcon />
            </button>
          </div>

          <Dropdown onSelect={handleClose} />

          {!isReferenceRoute && (
            <IntegrationSelector
              selectedIntegration={selectedIntegration}
              setSelectedIntegration={setSelectedIntegration}
              onNavigate={handleClose}
            />
          )}

          {isIntegrationRoute && selectedIntegration ? (
            <ul className="flex overflow-y-auto flex-col mt-6 max-h-full custom-scrollbar [&>*:first-child]:mt-0">
              {integrationPages.map((page, index) => {
                const Component = NODE_COMPONENTS[page.type];
                const pageUrl =
                  (page as Node).index?.url ||
                  (page as Node).url ||
                  `page-${index}`;
                const key = `${page.type}-${pageUrl}`;
                return (
                  <Component
                    key={key}
                    node={page as Node}
                    onNavigate={handleClose}
                  />
                );
              })}
            </ul>
          ) : isIntegrationRoute && !selectedIntegration ? (
            <IntegrationSelectorSkeleton />
          ) : (
            <ul className="flex overflow-y-auto flex-col mt-6 max-h-full custom-scrollbar [&>*:first-child]:mt-0">
              {pagesToShow.map((page, index) => {
                const Component = NODE_COMPONENTS[page.type];
                const pageUrl =
                  (page as Node).index?.url ||
                  (page as Node).url ||
                  `page-${index}`;
                const key = `${page.type}-${pageUrl}`;
                return (
                  <Component
                    key={key}
                    node={page as Node}
                    onNavigate={handleClose}
                  />
                );
              })}
            </ul>
          )}
        </aside>
      </OpenedFoldersProvider>
    </div>
  );
};

export default MobileSidebar;
