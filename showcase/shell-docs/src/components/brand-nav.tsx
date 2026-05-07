"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { SearchTrigger } from "./search-trigger";
import RocketIcon from "./icons/rocket";
import ConsoleIcon from "./icons/console";
import CloudIcon from "./icons/cloud";
import GithubIcon from "./icons/github";
import DiscordIcon from "./icons/discord";
import ExternalLinkIcon from "./icons/external-link";
import BurgerMenuIcon from "./icons/burger-menu";

// Inline brand mark — kept from the prior brand-nav so the logo continues
// to render before any /public asset swap. The visual structure around it
// (two-piece glass panel with slanted separator) mirrors docs.copilotkit.ai.
function CopilotKitMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="111 0 25 26"
      width="22"
      height="24"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="cpk_g0"
          x1="129.301"
          y1="2.339"
          x2="125.623"
          y2="12.452"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6430AB" />
          <stop offset="1" stopColor="#AA89D8" />
        </linearGradient>
        <linearGradient
          id="cpk_g1"
          x1="126.451"
          y1="8.039"
          x2="121.717"
          y2="17.187"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#005DBB" />
          <stop offset="1" stopColor="#3D92E8" />
        </linearGradient>
        <linearGradient
          id="cpk_g2"
          x1="128.565"
          y1="2.339"
          x2="127.139"
          y2="6.798"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#1B70C4" />
          <stop offset="1" stopColor="#54A4F2" />
        </linearGradient>
        <linearGradient
          id="cpk_g3"
          x1="117.94"
          y1="22.784"
          x2="132.981"
          y2="22.784"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4497EA" />
          <stop offset="0.2548" stopColor="#1463B2" />
          <stop offset="0.4987" stopColor="#0A437D" />
          <stop offset="0.6667" stopColor="#2476C8" />
          <stop offset="0.9725" stopColor="#0C549A" />
        </linearGradient>
      </defs>
      <path
        d="M119.539 8.67724C121.647 5.91912 123.397 3.19174 124.071 0.989235C124.089 0.929306 124.159 0.903848 124.211 0.938445C126.553 2.4891 130.818 3.50978 134.591 3.53373C134.655 3.53415 134.7 3.59815 134.677 3.65868C133.422 6.84085 131.89 12.5427 131.831 19.054C131.831 19.1507 131.695 19.1854 131.647 19.1014C129.5 15.3443 122.623 10.0649 119.574 8.81884C119.517 8.79565 119.501 8.72596 119.539 8.67724Z"
        fill="url(#cpk_g0)"
      />
      <path
        d="M126.653 6.99011C123.357 8.03363 120.345 8.61377 119.626 8.74558C119.581 8.75399 119.571 8.81729 119.615 8.83516C122.687 10.1126 129.53 15.3766 131.657 19.1184C131.661 19.1266 131.672 19.1296 131.68 19.1259C131.689 19.1218 131.693 19.1112 131.69 19.1021L126.653 6.99011Z"
        fill="url(#cpk_g1)"
      />
      <path
        d="M124.221 0.931583C127.042 2.47061 130.303 3.16182 134.629 3.52604C134.656 3.52836 134.665 3.56478 134.641 3.57743C134.087 3.86176 130.918 5.47449 128.565 6.33825C127.934 6.56966 127.3 6.78434 126.675 6.98241C126.662 6.98674 126.647 6.97992 126.641 6.96671L124.156 0.989873C124.139 0.949626 124.183 0.91071 124.221 0.931583Z"
        fill="url(#cpk_g2)"
      />
      <path
        d="M125.209 3.30419L122.405 12.6362M122.405 12.6362H129.07M122.405 12.6362L111.874 25.0387"
        stroke="#ABABAB"
        strokeWidth="0.321797"
        strokeLinecap="round"
      />
      <path
        d="M119.181 22.4856L117.94 22.6601C118.584 24.3624 119.904 25.1059 121.479 25.1059C125.341 25.1059 124.163 20.7388 126.4 20.7388C128.023 20.7388 127.364 24.2784 130.857 24.2784C132.989 24.2784 133.201 22.1307 132.837 21.2067C132.835 21.201 132.833 21.1959 132.83 21.1908L132.259 20.316C132.222 20.2578 132.131 20.2797 132.125 20.3489L132.018 21.4092C132.011 21.483 132.013 21.5565 132.021 21.6301C132.109 22.3627 132.165 24.1405 130.857 24.1405C129.477 24.1405 129.145 20.6468 126.4 20.6468C123.181 20.6468 123.594 24.968 121.618 24.968C120.313 24.968 119.319 23.497 119.181 22.4856Z"
        fill="url(#cpk_g3)"
      />
    </svg>
  );
}

const CLOUD_CTA_HREF =
  "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar";

const SHELL_HOST = process.env.NEXT_PUBLIC_SHELL_URL ?? "http://localhost:3000";

// LEFT cluster — preserves shell-docs's existing IA: Docs / Integrations /
// Reference. Visual pattern (icon-next-to-label) mirrors canonical.
type LeftLink = {
  href: string;
  label: string;
  icon: React.ReactNode;
  target?: "_blank" | "_self";
  showExternalLinkIcon?: boolean;
};

const LEFT_LINKS: LeftLink[] = [
  {
    icon: <RocketIcon className="text-[var(--text-secondary)]" />,
    label: "Docs",
    href: "/",
  },
  {
    icon: <CloudIcon className="text-[var(--text-secondary)]" />,
    label: "Integrations",
    href: `${SHELL_HOST}/integrations`,
  },
  {
    icon: <ConsoleIcon className="text-[var(--text-secondary)]" />,
    label: "Reference",
    href: "/reference",
  },
];

export interface BrandNavProps {
  // Preserved for backwards compat with the original call site signature.
  // The framework selector lives in the docs sidebar now, not the navbar.
  frameworkOptions?: unknown;
  frameworkCategoryOrder?: unknown;
}

export function BrandNav(_props: BrandNavProps = {}) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const pathname = usePathname();
  const posthog = usePostHog();

  // Active-route detection: anything under /reference highlights Reference,
  // anything under /integrations (cross-host) highlights Integrations,
  // everything else (root, framework-scoped pages) highlights Docs.
  const firstSegment = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
  const activeRoute =
    firstSegment === "/reference"
      ? "/reference"
      : firstSegment === "/integrations"
        ? `${SHELL_HOST}/integrations`
        : "/";

  // Close mobile sidebar when viewport expands beyond mobile breakpoint.
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && isMobileSidebarOpen) {
        setIsMobileSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobileSidebarOpen]);

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", { location: "docs_nav" });
    window.location.href = "https://copilotkit.ai/contact-us";
  };

  const handleFreeDeveloperAccessClick = (location: string) => {
    posthog?.capture("try_for_free_clicked", { location });
  };

  const handleToggleTheme = () => {
    document.documentElement.classList.toggle("dark");
    try {
      localStorage.theme = localStorage.theme === "dark" ? "light" : "dark";
    } catch {
      // localStorage may be blocked (private mode, embedded contexts) —
      // a class flip on documentElement is the load-bearing behavior.
    }
  };

  return (
    <nav className="sticky top-0 z-50 h-[68px] xl:h-[88px] p-1 xl:p-2 relative bg-[var(--bg)]">
      <div className="flex justify-between items-center w-full h-full">
        {/* Left half (logo + nav links) */}
        <div className="flex w-full h-full">
          <div
            className="flex gap-11 items-center w-full h-full rounded-l-2xl border border-r-0 backdrop-blur-lg border-[var(--border)]"
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            <Link
              href="/"
              className="flex items-center gap-2 pl-6 shrink-0"
              aria-label="CopilotKit Docs"
            >
              <CopilotKitMark />
              <span className="text-base font-bold tracking-tight text-[var(--text)]">
                CopilotKit
              </span>
              <span
                className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)] bg-[var(--accent-dim)] border border-[var(--border)]"
                aria-hidden="true"
              >
                Docs
              </span>
            </Link>
            <ul className="hidden gap-6 items-center h-full md:flex">
              {LEFT_LINKS.map((link) => {
                const hideIconAtNarrow =
                  link.label === "Docs" ||
                  link.label === "Reference" ||
                  link.label === "Integrations";
                const isActive = activeRoute === link.href;
                return (
                  <li key={link.href} className="relative h-full group">
                    <Link
                      href={link.href}
                      target={link.target}
                      className={`h-full ${
                        isActive ? "opacity-100" : "opacity-60"
                      } hover:opacity-100 transition-opacity duration-300`}
                    >
                      <span className="flex gap-2 items-center h-full text-[var(--text-secondary)]">
                        <span
                          className={
                            hideIconAtNarrow
                              ? "[@media(width<808px)]:hidden"
                              : ""
                          }
                        >
                          {link.icon}
                        </span>
                        <span className="text-sm font-medium">
                          {link.label}
                        </span>
                        {link.showExternalLinkIcon && (
                          <ExternalLinkIcon className="text-[var(--text-muted)]" />
                        )}
                      </span>
                    </Link>
                    <div
                      className={`absolute bottom-0 left-0 w-full h-[3px] bg-[var(--accent)] transition-opacity duration-300 ${
                        isActive
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Slanted end border — plain <img> avoids next/image's
           * static-import requirement and renders these decorative SVGs
           * exactly as authored. The light/dark variants pair with the
           * theme toggle below. */}
          <img
            src="/images/navbar/slanted-end-border-dark.svg"
            alt=""
            width={29}
            height={72}
            className="hidden -ml-px dark:inline-block shrink-0 h-full w-auto object-cover"
          />
          <img
            src="/images/navbar/slanted-end-border-light.svg"
            alt=""
            width={29}
            height={72}
            className="-ml-px dark:hidden shrink-0 h-full w-auto object-cover"
          />
        </div>

        {/* Right half (utilities + search + mobile burger) */}
        <div className="flex items-center w-max h-full shrink-0 -ml-[7px]">
          <img
            src="/images/navbar/slanted-start-border-dark.svg"
            alt=""
            width={29}
            height={72}
            className="hidden -mr-px dark:inline-block shrink-0 h-full w-auto object-cover"
          />
          <img
            src="/images/navbar/slanted-start-border-light.svg"
            alt=""
            width={29}
            height={72}
            className="-mr-px dark:hidden shrink-0 h-full w-auto object-cover"
          />

          <div
            className="flex gap-1 items-center pr-2 w-max h-full rounded-r-2xl border border-l-0 backdrop-blur-lg md:pr-4 shrink-0 border-[var(--border)]"
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            <button
              type="button"
              onClick={handleTalkToEngineersClick}
              className="hidden [@media(width>=1400px)]:flex items-center h-9 px-4 mr-2 text-sm font-medium rounded-full border border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors duration-200 cursor-pointer whitespace-nowrap"
              aria-label="Talk to our engineers"
            >
              Talk to Our Engineers
            </button>

            {/* Free Developer Access — icon-only at narrow widths between
             * 768px and 1028px (mirrors canonical visibility window). */}
            <Link
              href={CLOUD_CTA_HREF}
              target="_blank"
              onClick={() =>
                handleFreeDeveloperAccessClick("docs_navbar_right")
              }
              className="[@media(width>=1028px)]:hidden [@media(width<768px)]:hidden justify-center items-center w-11 h-full md:flex text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title="Free Developer Access"
            >
              <span className="flex items-center h-full">
                <CloudIcon />
              </span>
            </Link>

            <Link
              href="https://github.com/copilotkit/copilotkit"
              target="_blank"
              className="hidden md:flex justify-center items-center w-11 h-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title="GitHub"
            >
              <GithubIcon />
            </Link>

            <Link
              href="https://discord.gg/6dffbvGU3D"
              target="_blank"
              className="hidden md:flex justify-center items-center w-11 h-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title="Discord"
            >
              <DiscordIcon />
            </Link>

            <button
              className="hidden justify-center items-center w-11 h-full cursor-pointer md:flex"
              onClick={handleToggleTheme}
              aria-label="Toggle theme"
            >
              <img
                src="/images/navbar/theme-moon.svg"
                alt=""
                width={20}
                height={20}
                className="hidden dark:inline-block"
              />
              <img
                src="/images/navbar/theme-sun.svg"
                alt=""
                width={20}
                height={20}
                className="dark:hidden"
              />
            </button>

            <SearchTrigger />

            <button
              className="flex justify-center items-center w-11 h-full cursor-pointer md:hidden text-[var(--text-muted)]"
              onClick={() => setIsMobileSidebarOpen((prev) => !prev)}
              aria-label="Open menu"
            >
              <BurgerMenuIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile slide-out menu — kept simple; we expose the same LEFT_LINKS
       * the desktop nav surfaces, plus the Free Developer Access CTA and
       * Talk-to-Engineers button. The full mobile sidebar (with search +
       * sidebar tree) is owned by the docs page shell, not this nav. */}
      {isMobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-[280px] bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col"
            style={{ boxShadow: "-8px 0 30px rgba(0,0,0,0.1)" }}
          >
            <div className="flex items-center justify-end px-4 py-3 border-b border-[var(--border)]">
              <button
                onClick={() => setIsMobileSidebarOpen(false)}
                className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                aria-label="Close menu"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="flex flex-col px-4 py-4 gap-1">
              {LEFT_LINKS.map(({ href, label, icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2.5 text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-all"
                >
                  {icon}
                  {label}
                </Link>
              ))}
              <Link
                href={CLOUD_CTA_HREF}
                target="_blank"
                onClick={() => {
                  setIsMobileSidebarOpen(false);
                  handleFreeDeveloperAccessClick("docs_navbar_mobile");
                }}
                className="flex items-center gap-2 rounded-md px-3 py-2.5 text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-all"
              >
                <CloudIcon className="text-[var(--text-secondary)]" />
                Free Developer Access
                <ExternalLinkIcon className="opacity-70 ml-auto" />
              </Link>
              <button
                type="button"
                onClick={() => {
                  setIsMobileSidebarOpen(false);
                  handleTalkToEngineersClick();
                }}
                className="text-left rounded-md px-3 py-2.5 text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-all cursor-pointer"
                aria-label="Talk to our engineers"
              >
                Talk to Our Engineers
              </button>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
