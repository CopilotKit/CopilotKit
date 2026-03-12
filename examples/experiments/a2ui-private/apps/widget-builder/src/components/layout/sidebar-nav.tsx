"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SquarePlus,
  LayoutGrid,
  Box,
  Shapes,
  LucideIcon,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  subtitle?: string;
  href: string;
  external?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

function NavItem({
  icon: Icon,
  label,
  subtitle,
  href,
  external,
  selected,
  onClick,
}: NavItemProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
        selected
          ? "bg-white text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-white/50 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="truncate">{label}</span>
        {subtitle && <span className="text-xs opacity-75">{subtitle}</span>}
      </div>
    </Link>
  );
}

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  const navItems = [
    { icon: SquarePlus, label: "Create", href: "/" },
    { icon: LayoutGrid, label: "Gallery", href: "/gallery" },
    { icon: Box, label: "Components", href: "/components" },
    { icon: Shapes, label: "Icons", href: "/icons" },
    {
      icon: BookOpen,
      label: "Tutorial",
      subtitle: "CopilotKit + A2UI",
      external: true,
      href: "https://docs.copilotkit.ai/a2a/generative-ui/declarative-a2ui",
    },
  ];

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => (
        <NavItem
          key={item.href}
          icon={item.icon}
          label={item.label}
          subtitle={item.subtitle}
          href={item.href}
          external={item.external}
          selected={pathname === item.href}
          onClick={onNavigate}
        />
      ))}
    </nav>
  );
}
