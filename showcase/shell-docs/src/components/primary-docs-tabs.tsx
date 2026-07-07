"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PrimaryNavIcon } from "./primary-nav-icon";
import type { PrimaryNavIconKind } from "./primary-nav-icon";

interface PrimaryDocsLink {
  href: string;
  icon: PrimaryNavIconKind;
  label: string;
}

const PRIMARY_DOCS_LINKS: PrimaryDocsLink[] = [
  {
    href: "/",
    label: "Docs",
    icon: "docs",
  },
  {
    href: "/reference",
    label: "Reference",
    icon: "reference",
  },
  {
    href: "/cookbook",
    label: "Cookbook",
    icon: "cookbook",
  },
];

function getActiveRoute(pathname: string) {
  const firstSegment = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;

  if (firstSegment === "/reference") {
    return "/reference";
  }

  if (firstSegment === "/cookbook") {
    return "/cookbook";
  }

  return "/";
}

export function PrimaryDocsTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const activeRoute = getActiveRoute(pathname);

  return (
    <nav className={className} aria-label="Primary docs sections">
      {PRIMARY_DOCS_LINKS.map((link) => {
        const isActive = activeRoute === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`shell-docs-radius-control shell-docs-primary-tab ${
              isActive
                ? "shell-docs-nav-link-active"
                : "shell-docs-nav-link-idle"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            <PrimaryNavIcon
              kind={link.icon}
              active={isActive}
              className="h-4 w-4"
            />
            <span className="shell-docs-nav-link-label">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
