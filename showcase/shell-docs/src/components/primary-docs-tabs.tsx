"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChefHat } from "lucide-react";
import BookIcon from "./icons/book";

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
            {link.icon}
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
