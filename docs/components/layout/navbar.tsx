"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "fumadocs-core/link"
import { usePathname } from "next/navigation"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
// Components
import { Logo } from "@/app/logo"
import SearchDialogButton from "@/components/ui/search-button"
import MobileSidebar from "@/components/layout/mobile-sidebar"
// Icons
import RocketIcon from "@/components/ui/icons/rocket"
import PuzzleIcon from "@/components/ui/icons/puzzle"
import ConsoleIcon from "@/components/ui/icons/console"
import CloudIcon from "@/components/ui/icons/cloud"
import GithubIcon from "@/components/ui/icons/github"
import DiscordIcon from "@/components/ui/icons/discord"
import ExternalLinkIcon from "@/components/ui/icons/external-link"
import BurgerMenuIcon from "@/components/ui/icons/burger-menu"

export interface NavbarLink {
  href: string
  icon: React.ReactNode
  label?: string
  target?: "_blank" | "_self" | "_parent" | "_top"
  showExternalLinkIcon?: boolean
}

interface NavbarProps {
  pageTree: DocsLayoutProps["tree"]
}

export const LEFT_LINKS: NavbarLink[] = [
  {
    icon: <RocketIcon />,
    label: "Overview",
    href: "/",
  },
  {
    icon: <PuzzleIcon />,
    label: "Integrations",
    href: "/integrations",
  },
  {
    icon: <ConsoleIcon />,
    label: "API Reference",
    href: "/reference",
  },
  {
    icon: <CloudIcon />,
    label: "Copilot Cloud",
    href: "https://cloud.copilotkit.ai",
    target: "_blank",
    showExternalLinkIcon: true,
  },
]

const RIGHT_LINKS: NavbarLink[] = [
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

const Navbar = ({ pageTree }: NavbarProps) => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [isZenMode, setIsZenMode] = useState(false)
  const pathname = usePathname()
  const activeRoute = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`

  const handleToggleTheme = () => {
    document.documentElement.classList.toggle("dark")
    localStorage.theme = localStorage.theme === "dark" ? "light" : "dark"
  }

  const handleToggleZenMode = () => {
    setIsZenMode(!isZenMode)
    document.documentElement.classList.toggle("zen-mode")
  }

  return (
    <>
      {isZenMode && (
        <button
          onClick={handleToggleZenMode}
          className="fixed top-4 right-4 z-50 p-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
          title="Exit Zen mode"
          aria-label="Exit Zen mode"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        </button>
      )}
    <nav className="h-[68px] xl:h-[88px] p-1 xl:p-2 relative">
      {isMobileSidebarOpen && (
        <MobileSidebar
          pageTree={pageTree}
          setIsOpen={setIsMobileSidebarOpen}
          handleToggleTheme={handleToggleTheme}
        />
      )}

      <div className="flex justify-between items-center w-full h-full">
        <div className="flex w-full h-full">
          <div className="flex gap-11 items-center w-full h-full rounded-l-2xl border border-r-0 backdrop-blur-lg border-border bg-glass-background">
            <Logo className="pl-6" />
            <ul className="hidden gap-6 items-center h-full lg:flex">
              {LEFT_LINKS.map((link) => (
                <li key={link.href} className="relative h-full group">
                  <Link
                    href={link.href}
                    target={link.target}
                    className={`h-full ${
                      activeRoute === link.href ? "opacity-100" : "opacity-50"
                    } hover:opacity-100 transition-opacity duration-300`}
                  >
                    <span className="flex gap-2 items-center h-full">
                      {link.icon}

                      <span className="text-sm font-medium">{link.label}</span>

                      {link.showExternalLinkIcon && <ExternalLinkIcon />}
                    </span>
                  </Link>
                  <div
                    className={`absolute bottom-0 left-0 w-full h-[3px] bg-[#7076D5] transition-opacity duration-300 ${
                      activeRoute === link.href
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  />
                </li>
              ))}
            </ul>
          </div>

          <Image
            src="/images/navbar/slanted-end-border-dark.svg"
            alt="Slanted end border"
            width={29}
            height={72}
            className="hidden -ml-px dark:inline-block shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />
          <Image
            src="/images/navbar/slanted-end-border-light.svg"
            alt="Slanted end border"
            width={29}
            height={72}
            className="-ml-px dark:hidden shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />
        </div>

        <div className="flex items-center w-max h-full shrink-0 -ml-[7px]">
          <Image
            src="/images/navbar/slanted-start-border-dark.svg"
            alt="Slanted start border"
            width={29}
            height={72}
            className="hidden -mr-px dark:inline-block shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />
          <Image
            src="/images/navbar/slanted-start-border-light.svg"
            alt="Slanted start border"
            width={29}
            height={72}
            className="-mr-px dark:hidden shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />

          <div className="flex gap-1 items-center pr-2 w-max h-full rounded-r-2xl border border-l-0 backdrop-blur-lg lg:pr-4 shrink-0 border-border bg-glass-background">
            {RIGHT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target={link.target}
                className="hidden justify-center items-center w-11 h-full lg:flex"
              >
                <span className="flex items-center h-full">{link.icon}</span>
              </Link>
            ))}

            <button
              className="hidden justify-center items-center w-11 h-full cursor-pointer lg:flex"
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

            <SearchDialogButton />

            <button
              className="hidden justify-center items-center w-11 h-full cursor-pointer lg:flex"
              onClick={handleToggleZenMode}
              title={isZenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isZenMode ? (
                  <>
                    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                  </>
                ) : (
                  <>
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </>
                )}
              </svg>
            </button>

            <button
              className="flex justify-center items-center w-11 h-full cursor-pointer lg:hidden"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <BurgerMenuIcon />
            </button>
          </div>
        </div>
      </div>
    </nav>
    </>
  )
}

export default Navbar
