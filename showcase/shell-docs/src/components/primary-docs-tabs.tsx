"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChefHat, Star } from "lucide-react";
import BookIcon from "./icons/book";
import { DocsMegaMenu } from "./docs-mega-menu";
import {
  INTELLIGENCE_DOCS_HREF,
  isDocsExplorePath,
  isIntelligenceDocsPath,
} from "@/lib/docs-mega-menu";

const PRIMARY_DOCS_LINKS = [
  {
    href: "/",
    label: "Docs",
    icon: <BookIcon className="h-4 w-4 text-current" />,
  },
  {
    href: "/reference",
    label: "Reference",
    icon: <BookIcon className="h-4 w-4 text-current" />,
  },
  {
    href: "/cookbook",
    label: "Cookbook",
    icon: <ChefHat className="h-4 w-4 text-current" />,
  },
  {
    href: INTELLIGENCE_DOCS_HREF,
    label: "Intelligence",
    icon: <Star className="h-4 w-4 text-current" />,
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

  if (isIntelligenceDocsPath(pathname)) {
    return INTELLIGENCE_DOCS_HREF;
  }

  return "/";
}

export function PrimaryDocsTabs({
  className,
  exploreMenu = false,
}: {
  className?: string;
  exploreMenu?: boolean;
}) {
  const pathname = usePathname();
  const activeRoute = getActiveRoute(pathname);

  return (
    <nav className={className} aria-label="Primary docs sections">
      {PRIMARY_DOCS_LINKS.map((link) => {
        const isActive = activeRoute === link.href;
        const tabClassName = `shell-docs-radius-control shell-docs-primary-tab ${
          isActive ? "shell-docs-nav-link-active" : "shell-docs-nav-link-idle"
        }`;

        if (exploreMenu && link.href === "/") {
          return (
            <DocsMegaMenu
              key={link.href}
              triggerClassName={`shell-docs-radius-control shell-docs-primary-tab ${
                isDocsExplorePath(pathname)
                  ? "shell-docs-nav-link-active"
                  : "shell-docs-nav-link-idle"
              }`}
            />
          );
        }

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`${tabClassName}${
              link.href === INTELLIGENCE_DOCS_HREF
                ? " shell-docs-nav-link-intelligence"
                : ""
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {link.icon}
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
