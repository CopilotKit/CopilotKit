"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

function AgUiIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 57 66"
      width="14"
      height="16"
      className={className}
      aria-hidden="true"
    >
      <g
        transform="translate(2, -2)"
        stroke="currentColor"
        strokeWidth="3.3125"
        fill="none"
      >
        <g transform="translate(0, 4)">
          <path
            d="M0,25.9335975 L16.5448881,6.52325783e-15 C40.848296,5.37332138 53,8.05998207 53,8.05998207 L43.1229639,62 L0,25.9335975 Z"
            strokeLinejoin="round"
          />
          <line x1="16.5828221" y1="-1.07552856e-15" x2="43.2453988" y2="62" />
          <line x1="0" y1="25.9335975" x2="53" y2="8.48421053" />
        </g>
      </g>
    </svg>
  );
}

type Brand = "copilotkit" | "ag-ui";

const COPILOTKIT_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/integrations", label: "Integrations" },
  { href: "/reference", label: "Reference" },
];

const AG_UI_LINKS = [
  { href: "/ag-ui", label: "Overview" },
  { href: "/ag-ui/concepts/architecture", label: "Concepts" },
  { href: "/ag-ui/quickstart/introduction", label: "Quick Start" },
  { href: "/ag-ui/sdk/js/core/overview", label: "JS SDK" },
  { href: "/ag-ui/sdk/python/core/overview", label: "Python SDK" },
];

// Match `/ag-ui` exactly OR `/ag-ui/...`, but NOT `/ag-ui-anything` —
// a bare `startsWith("/ag-ui")` would incorrectly classify a hypothetical
// `/ag-ui-foo` slug as AG-UI, which misroutes the nav.
function activeBrandFromPath(pathname: string): Brand {
  if (pathname === "/ag-ui" || pathname.startsWith("/ag-ui/")) return "ag-ui";
  return "copilotkit";
}

export function BrandNav() {
  const pathname = usePathname();
  const active = activeBrandFromPath(pathname);
  const links = active === "copilotkit" ? COPILOTKIT_LINKS : AG_UI_LINKS;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg-surface)]/90 backdrop-blur-lg">
      <div className="mx-auto flex h-[52px] items-center justify-between px-6">
        {/* Brand tabs */}
        <div className="flex items-center gap-0">
          <Link
            href="/"
            className="relative flex items-center gap-1.5 px-1 pb-1 text-sm font-bold tracking-tight transition-colors"
            style={{
              color:
                active === "copilotkit" ? "var(--accent)" : "var(--text-faint)",
            }}
          >
            <CopilotKitIcon />
            CopilotKit
            {active === "copilotkit" && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                style={{ background: "var(--accent)" }}
              />
            )}
          </Link>
          <span className="mx-2 text-[var(--border)] select-none">|</span>
          <Link
            href="/ag-ui"
            className="relative flex items-center gap-1.5 px-1 pb-1 text-sm font-bold tracking-tight transition-colors"
            style={{
              color: active === "ag-ui" ? "var(--accent)" : "var(--text-faint)",
            }}
          >
            <AgUiIcon />
            AG-UI
            {active === "ag-ui" && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                style={{ background: "var(--accent)" }}
              />
            )}
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

        {/* Desktop search */}
        <div className="hidden sm:block">
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
          {/* Panel — explicitly layered above the backdrop (z-[51] vs z-50)
              so layering doesn't rely on DOM sibling order. */}
          <div
            className="fixed top-0 right-0 bottom-0 z-[51] w-[280px] bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col"
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
            </div>
            {/* Cross-brand link at bottom — mirrors the top-nav brand
                switcher, pointing at whichever brand ISN'T currently
                active. Previously hardcoded to `/ag-ui`, which sent
                users from an AG-UI page back to the AG-UI homepage
                (same brand) instead of crossing over to CopilotKit. */}
            <div className="mt-auto px-4 py-4 border-t border-[var(--border)]">
              {active === "ag-ui" ? (
                <Link
                  href="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2.5 text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all"
                >
                  <CopilotKitIcon />
                  CopilotKit
                </Link>
              ) : (
                <Link
                  href="/ag-ui"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2.5 text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all"
                >
                  <AgUiIcon />
                  AG-UI
                </Link>
              )}
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
