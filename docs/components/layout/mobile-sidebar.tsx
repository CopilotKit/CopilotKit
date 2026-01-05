"use client"

import Image from "next/image"
import Link from "fumadocs-core/link"
import { usePathname } from "next/navigation"
import { useMemo, useState } from "react"
// Components
import Separator from "@/components/ui/sidebar/separator"
import Page from "@/components/ui/sidebar/page"
import Folder from "@/components/ui/sidebar/folder"
import Dropdown from "@/components/ui/mobile-sidebar/dropdown"
import IntegrationSelector from "@/components/ui/integrations-sidebar/integration-selector"
import { OpenedFoldersProvider } from "@/lib/hooks/use-opened-folders"
// Icons
import DiscordIcon from "@/components/ui/icons/discord"
import GithubIcon from "@/components/ui/icons/github"
import CrossIcon from "@/components/ui/icons/cross"
// Types
import { NavbarLink } from "./navbar"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import { Integration } from "../ui/integrations-sidebar/integration-selector"

interface MobileSidebarProps {
  pageTree: DocsLayoutProps["tree"]
  setIsOpen: (isOpen: boolean) => void
  handleToggleTheme: () => void
}

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string }

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
]

const NODE_COMPONENTS: Record<
  Node["type"],
  React.ComponentType<{ node: Node; onNavigate?: () => void }>
> = {
  separator: Separator,
  page: Page,
  folder: Folder,
}

const MobileSidebar = ({
  pageTree,
  setIsOpen,
  handleToggleTheme,
}: MobileSidebarProps) => {
  const pages = pageTree.children
  const isIntegrationRoute = usePathname().startsWith("/integrations")
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null)

  return (
    <div className="flex fixed top-0 left-0 z-50 justify-end p-1 w-full h-full bg-black/30">
      <OpenedFoldersProvider>
        <aside className="flex flex-col w-full max-w-[280px] h-[calc(100vh-8px)] border backdrop-blur-3xl border-r-0 border-border bg-white/50 dark:bg-white/[0.01] rounded-2xl pl-3 pr-1 ">
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
              onClick={() => setIsOpen(false)}
            >
              <CrossIcon />
            </button>
          </div>

          <Dropdown onSelect={() => setIsOpen(false)} />

          {isIntegrationRoute && (
            <IntegrationSelector
              selectedIntegration={selectedIntegration}
              setSelectedIntegration={setSelectedIntegration}
            />
          )}

          <ul className="flex overflow-y-auto flex-col mt-6 max-h-full custom-scrollbar [&>*:first-child]:mt-0">
            {pages.map((page) => {
              const Component = NODE_COMPONENTS[page.type]
              return (
                <Component
                  key={crypto.randomUUID()}
                  node={page as Node}
                  onNavigate={() => setIsOpen(false)}
                />
              )
            })}
          </ul>
        </aside>
      </OpenedFoldersProvider>
    </div>
  )
}

export default MobileSidebar
