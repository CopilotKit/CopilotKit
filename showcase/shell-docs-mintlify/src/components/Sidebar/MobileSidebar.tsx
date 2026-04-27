import { useState, useEffect } from "react";
import { cn, Icon } from "@mintlify/components";
import type { NavNode, TabInfo } from "@mintlify/astro/helpers";
import { unwrapNav } from "@mintlify/astro/helpers";
import { type SidebarItemStyle, type AnchorItem } from "./types";
import { SidebarEntries } from "./SidebarEntries";
import { Anchors } from "./Anchors";
import { TabsDropdown } from "./TabsDropdown";
import { IntegrationPill } from "../IntegrationPill";

interface MobileSidebarProps {
  navigation: NavNode;
  currentPath: string;
  tabs?: TabInfo[];
  anchors?: AnchorItem[];
  sidebarItemStyle?: SidebarItemStyle;
  showDivider?: boolean;
  /** Live GitHub star count, formatted (e.g. "30.5k"). Build-time fetched in the parent. */
  starsLabel?: string;
  /** Numeric star count for the aria-label. */
  stars?: number;
}

const GITHUB_URL = "https://github.com/CopilotKit/CopilotKit";
const DISCORD_URL = "https://discord.gg/6dffbvGU3D";
const TALK_URL = "https://calendly.com/d/cnqt-yr9-hxr/talk-to-copilotkit";

export function MobileSidebar({
  navigation,
  currentPath,
  tabs = [],
  anchors = [],
  sidebarItemStyle = "container",
  showDivider = false,
  starsLabel,
  stars,
}: MobileSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const entries = unwrapNav(navigation, currentPath);

  useEffect(() => {
    const handleToggle = () => setIsOpen((prev) => !prev);
    window.addEventListener("toggle-mobile-sidebar", handleToggle);
    return () =>
      window.removeEventListener("toggle-mobile-sidebar", handleToggle);
  }, []);

  useEffect(() => {
    setIsOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm z-60 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="fixed bg-white dark:bg-zinc-950 rounded-full top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-100 shadow-md z-80 lg:hidden"
          aria-label="Close navigation"
        >
          <Icon icon="x" iconLibrary="lucide" size={18} />
        </button>
      )}

      <div
        className={cn(
          "fixed top-0 left-0 bottom-0 w-[20rem] bg-white dark:bg-zinc-950 dark:border-r dark:border-gray-800 z-70 transition-transform duration-300 ease-in-out lg:hidden",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 pt-6 pb-4">
            <img
              src="/logo/light.svg"
              alt="CopilotKit"
              className="h-7 w-auto block dark:hidden"
            />
            <img
              src="/logo/dark.svg"
              alt="CopilotKit"
              className="h-7 w-auto hidden dark:block"
            />
          </div>

          <nav className="flex-1 overflow-y-auto pt-4 pb-4">
            {tabs.length > 0 && (
              <div className="px-4 mb-4">
                <TabsDropdown tabs={tabs} />
              </div>
            )}

            <div className="px-4 mb-4">
              <IntegrationPill currentPath={currentPath} />
            </div>

            {anchors.length > 0 && (
              <div className="px-2">
                <Anchors anchors={anchors} />
              </div>
            )}

            <div className="px-4">
              <SidebarEntries
                entries={entries}
                currentPath={currentPath}
                sidebarItemStyle={sidebarItemStyle}
                showDivider={showDivider}
              />
            </div>
          </nav>

          <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex flex-col gap-2">
            <a
              href={TALK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center h-10 px-4 rounded-[0.85rem] bg-(--primary) text-white text-sm font-medium shadow-sm hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] transition-colors"
            >
              Talk with us
            </a>
            <div className="flex items-center gap-2">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={
                  stars ? `GitHub — ${stars.toLocaleString()} stars` : "GitHub"
                }
                className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-[0.85rem] text-gray-700 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium ring-1 ring-gray-200/70 dark:ring-gray-700/60"
              >
                <Icon
                  icon="github"
                  iconLibrary="fontawesome"
                  iconType="brands"
                  size={16}
                  color="currentColor"
                />
                {starsLabel && (
                  <span className="tabular-nums">{starsLabel}</span>
                )}
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord"
                className="flex items-center justify-center w-10 h-10 rounded-[0.85rem] text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors ring-1 ring-gray-200/70 dark:ring-gray-700/60"
              >
                <Icon
                  icon="discord"
                  iconLibrary="fontawesome"
                  iconType="brands"
                  size={18}
                  color="currentColor"
                />
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
