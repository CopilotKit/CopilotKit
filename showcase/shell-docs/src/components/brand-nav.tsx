"use client";

import { useState } from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { SearchTrigger } from "./search-trigger";

function CopilotKitIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="111 0 25 26"
      width="18"
      height="20"
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

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.5 19a4.5 4.5 0 1 0-1.5-8.74A6 6 0 1 0 6.5 19h11Z" />
    </svg>
  );
}

function ExternalArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

const CLOUD_CTA = {
  label: "Free Developer Access",
  href: "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar",
};

const SHELL_HOST = process.env.NEXT_PUBLIC_SHELL_URL ?? "http://localhost:3000";

const COPILOTKIT_LINKS = [
  { href: "/", label: "Docs" },
  { href: `${SHELL_HOST}/integrations`, label: "Integrations" },
  { href: "/reference", label: "Reference" },
];

export interface BrandNavProps {
  // Note: the framework selector previously lived in the top bar. It's
  // now rendered at the top of the docs sidebar instead — mirroring the
  // docs.copilotkit.ai reference. Props preserved for API compatibility
  // with the current call site but intentionally unused here.
  frameworkOptions?: unknown;
  frameworkCategoryOrder?: unknown;
}

export function BrandNav(_props: BrandNavProps = {}) {
  const links = COPILOTKIT_LINKS;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const posthog = usePostHog();

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", { location: "docs_nav" });
    window.location.href = "https://copilotkit.ai/contact-us";
  };

  const handleFreeDeveloperAccessClick = (location: string) => {
    posthog?.capture("try_for_free_clicked", { location });
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-surface)]/90 backdrop-blur-lg">
      <div className="mx-auto flex h-[52px] items-center justify-between px-6">
        {/* Brand tabs */}
        <div className="flex items-center gap-0">
          <Link
            href="/"
            className="relative flex items-center gap-1.5 px-1 pb-1 text-sm font-bold tracking-tight transition-colors"
            style={{ color: "var(--accent)" }}
          >
            <CopilotKitIcon />
            CopilotKit
            <span
              className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
              style={{ background: "var(--accent)" }}
            />
          </Link>
        </div>

        {/* Context-dependent nav links (desktop) */}
        <div className="hidden sm:flex items-center gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Desktop: Talk-to-Engineers + Cloud CTA + search */}
        <div className="hidden sm:flex items-center gap-2">
          <button
            type="button"
            onClick={handleTalkToEngineersClick}
            className="hidden [@media(width>=1400px)]:flex items-center rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--text-muted)] hover:text-[#7076D5] hover:bg-[#7076D5]/10 transition-colors duration-200 cursor-pointer whitespace-nowrap"
            aria-label="Talk to our engineers"
          >
            Talk to Our Engineers
          </button>
          <a
            href={CLOUD_CTA.href}
            target="_blank"
            rel="noreferrer"
            onClick={() => handleFreeDeveloperAccessClick("docs_navbar")}
            className="no-underline flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-all"
          >
            <CloudIcon />
            <span className="[@media(width<1100px)]:hidden">
              {CLOUD_CTA.label}
            </span>
            <ExternalArrowIcon className="[@media(width<1100px)]:hidden opacity-70" />
          </a>
          <SearchTrigger />
        </div>

        {/* Mobile: search icon + hamburger */}
        <div className="flex sm:hidden items-center gap-1">
          <SearchTrigger iconOnly />
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            aria-label="Open menu"
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
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile slide-out menu */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Panel */}
          <div
            className="fixed top-0 right-0 bottom-0 z-50 w-[280px] bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col"
            style={{
              boxShadow: "-8px 0 30px rgba(0,0,0,0.1)",
              animation: "mobileMenuSlideIn 0.2s ease",
            }}
          >
            {/* Close button */}
            <div className="flex items-center justify-end px-4 py-3 border-b border-[var(--border)]">
              <button
                onClick={() => setMobileMenuOpen(false)}
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
            {/* Nav links */}
            <div className="flex flex-col px-4 py-4 gap-1">
              {links.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-md px-3 py-2.5 text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-all"
                >
                  {label}
                </Link>
              ))}
              <a
                href={CLOUD_CTA.href}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleFreeDeveloperAccessClick("docs_navbar_mobile");
                }}
                className="no-underline flex items-center gap-2 rounded-md px-3 py-2.5 text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-all"
              >
                <CloudIcon />
                {CLOUD_CTA.label}
                <ExternalArrowIcon className="opacity-70" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleTalkToEngineersClick();
                }}
                className="text-left rounded-md px-3 py-2.5 text-[14px] font-medium text-[var(--text-secondary)] hover:text-[#7076D5] hover:bg-[#7076D5]/10 transition-all cursor-pointer"
                aria-label="Talk to our engineers"
              >
                Talk to Our Engineers
              </button>
            </div>
          </div>
          <style jsx global>{`
            @keyframes mobileMenuSlideIn {
              from {
                transform: translateX(100%);
              }
              to {
                transform: translateX(0);
              }
            }
          `}</style>
        </>
      )}
    </nav>
  );
}
