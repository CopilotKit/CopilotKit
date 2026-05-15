"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "fumadocs-core/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
// Components
import { Logo } from "@/app/logo";
import SearchDialogButton from "@/components/ui/search-button";
import MobileSidebar from "@/components/layout/mobile-sidebar";
// Icons
import RocketIcon from "@/components/ui/icons/rocket";
import ConsoleIcon from "@/components/ui/icons/console";
import CloudIcon from "@/components/ui/icons/cloud";
import GithubIcon from "@/components/ui/icons/github";
import DiscordIcon from "@/components/ui/icons/discord";
import ExternalLinkIcon from "@/components/ui/icons/external-link";
import BurgerMenuIcon from "@/components/ui/icons/burger-menu";
import { BookOpenIcon, ScrollTextIcon } from "lucide-react";

export interface NavbarLink {
  href: string;
  icon: React.ReactNode;
  label?: string;
  target?: "_blank" | "_self" | "_parent" | "_top";
  showExternalLinkIcon?: boolean;
}

interface NavbarProps {
  pageTree: DocsLayoutProps["tree"];
}

export const LEFT_LINKS: NavbarLink[] = [
  {
    icon: <RocketIcon />,
    label: "Documentation",
    href: "/",
  },
  {
    icon: <ConsoleIcon />,
    label: "API Reference",
    href: "/reference",
  },
  {
    icon: <BookOpenIcon size={16} />,
    label: "Learn",
    href: "/learn",
  },
  {
    icon: <CloudIcon />,
    label: "Free Developer Access",
    href: "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar",
    target: "_blank",
    showExternalLinkIcon: true,
  },
];

const RIGHT_LINKS: NavbarLink[] = [
  {
    icon: <CloudIcon />,
    href: "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar",
    target: "_blank",
    label: "Free Developer Access",
  },
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

const Navbar = ({ pageTree }: NavbarProps) => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [lastDocsPath, setLastDocsPath] = useState<string | null>(null);
  const pathname = usePathname();
  const posthog = usePostHog();

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", { location: "docs_nav" });
    window.location.href = "https://copilotkit.ai/talk-to-an-engineer";
  };

  // Read sessionStorage on client only to avoid hydration mismatch (tab-specific)
  useEffect(() => {
    setLastDocsPath(sessionStorage.getItem("lastDocsPath"));
  }, []);

  // Determine active route based on current path
  const firstSegment = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
  const isReferencePage = firstSegment === "/reference";
  const isLearnPage = firstSegment === "/learn";
  // Reference pages → /reference, Learn pages → /learn, Everything else (root + integrations) → /
  const activeRoute = isReferencePage
    ? "/reference"
    : isLearnPage
      ? "/learn"
      : "/";

  // Get the appropriate href for Documentation link
  const getDocumentationHref = () => {
    // If we're on a reference page, try to restore last docs path
    if (isReferencePage && lastDocsPath) {
      return lastDocsPath;
    }
    return "/";
  };

  // Close mobile sidebar when viewport expands beyond mobile breakpoint (md: 768px)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && isMobileSidebarOpen) {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    // Check on mount in case viewport is already large
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isMobileSidebarOpen]);

  const handleTryForFreeClick = (location: string) => {
    posthog?.capture("try_for_free_clicked", { location });
  };

  const handleToggleTheme = () => {
    document.documentElement.classList.toggle("dark");
    localStorage.theme = localStorage.theme === "dark" ? "light" : "dark";
  };

  return (
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
          <div
            className="flex gap-11 items-center w-full h-full rounded-l-2xl border border-r-0 backdrop-blur-lg border-border"
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            <Logo className="pl-6" />
            <ul className="hidden gap-6 items-center h-full md:flex">
              {LEFT_LINKS.map((link) => {
                // Hide only Free Developer Access at narrow widths
                const hideAtNarrow = link.label === "Free Developer Access";
                // Hide icons for Documentation and API Reference at very narrow widths
                const hideIconAtNarrow =
                  link.label === "Documentation" ||
                  link.label === "Learn" ||
                  link.label === "API Reference";
                // Use dynamic href for Documentation link
                const href =
                  link.label === "Documentation"
                    ? getDocumentationHref()
                    : link.href;

                return (
                  <li
                    key={link.href}
                    className={`relative h-full group ${hideAtNarrow ? "[@media(width<1100px)]:hidden" : ""}`}
                  >
                    <Link
                      href={href}
                      target={link.target}
                      onClick={
                        link.label === "Free Developer Access"
                          ? () =>
                              handleTryForFreeClick("docs_navbar_left")
                          : undefined
                      }
                      className={`h-full ${
                        activeRoute === link.href ? "opacity-100" : "opacity-50"
                      } hover:opacity-100 transition-opacity duration-300`}
                      suppressHydrationWarning={link.target === "_blank"}
                    >
                      <span className="flex gap-2 items-center h-full">
                        <span
                          className={
                            hideIconAtNarrow
                              ? "[@media(width<808px)]:hidden"
                              : ""
                          }
                        >
                          {link.icon}
                        </span>

                        <span className="text-sm font-medium whitespace-nowrap">
                          {link.label}
                        </span>

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
                );
              })}
            </ul>
          </div>

          <Image
            src="/images/navbar/slanted-end-border-dark.svg"
            alt="Slanted end border"
            width={29}
            height={72}
            className="hidden -ml-px dark:inline-block shrink-0 h-full w-auto object-cover"
          />
          <Image
            src="/images/navbar/slanted-end-border-light.svg"
            alt="Slanted end border"
            width={29}
            height={72}
            className="-ml-px dark:hidden shrink-0 h-full w-auto object-cover"
          />
        </div>

        <div className="flex items-center w-max h-full shrink-0 -ml-[7px]">
          <Image
            src="/images/navbar/slanted-start-border-dark.svg"
            alt="Slanted start border"
            width={29}
            height={72}
            className="hidden -mr-px dark:inline-block shrink-0 h-full w-auto object-cover"
          />
          <Image
            src="/images/navbar/slanted-start-border-light.svg"
            alt="Slanted start border"
            width={29}
            height={72}
            className="-mr-px dark:hidden shrink-0 h-full w-auto object-cover"
          />

          <div
            className="flex gap-1 items-center pr-2 w-max h-full rounded-r-2xl border border-l-0 backdrop-blur-lg md:pr-4 shrink-0 border-border"
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            {/* Talk to an Engineer — text pill at ≥1100px, compact
             * calendar icon at md-to-1099px (when the rest of the
             * right cluster is icon-only). Both share gradient +
             * shimmer treatment. */}
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden [@media(width>=1100px)]:flex items-center h-9 px-4 mr-2 text-sm font-medium rounded-full bg-gradient-to-r from-indigo-500/90 to-purple-500/90 text-white shadow-sm hover:from-indigo-500 hover:to-purple-500 hover:shadow-md transition-all duration-200 cursor-pointer whitespace-nowrap relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
              aria-label="Talk to an engineer"
            >
              Talk to an Engineer
            </button>
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden md:flex [@media(width>=1100px)]:hidden justify-center items-center w-9 h-9 mr-2 rounded-full bg-gradient-to-r from-indigo-500/90 to-purple-500/90 text-white shadow-sm hover:from-indigo-500 hover:to-purple-500 hover:shadow-md transition-all duration-200 cursor-pointer relative overflow-hidden after:content-[''] after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:-translate-x-full hover:after:translate-x-[100%] after:transition-transform after:duration-700 after:pointer-events-none"
              aria-label="Talk to an engineer"
              title="Talk to an Engineer"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>

            {RIGHT_LINKS.map((link) => {
              // Only show Free Developer Access icon at narrow widths (between 768px and 1099px) — matches Talk-to-Engineer pill↔calendar-icon transition.
              const isIconOnlyLink = link.label === "Free Developer Access";

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  target={link.target}
                  onClick={
                    link.label === "Free Developer Access"
                      ? () => handleTryForFreeClick("docs_navbar_right")
                      : undefined
                  }
                  className={`${isIconOnlyLink ? "[@media(width>=1100px)]:hidden [@media(width<768px)]:hidden" : "hidden"} justify-center items-center w-11 h-full md:flex`}
                  title={link.label}
                  suppressHydrationWarning={link.target === "_blank"}
                >
                  <span className="flex items-center h-full">{link.icon}</span>
                </Link>
              );
            })}

            <button
              className="hidden justify-center items-center w-11 h-full cursor-pointer md:flex"
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
              className="flex justify-center items-center w-11 h-full cursor-pointer md:hidden"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <BurgerMenuIcon />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
