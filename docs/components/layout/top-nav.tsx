"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  RocketIcon,
  CloudIcon, 
  TerminalIcon,
  SearchIcon 
} from "lucide-react";

export function TopNav() {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/",
      label: "Overview",
      icon: RocketIcon,
      isActive: pathname === "/"
    },
    {
      href: "https://cloud.copilotkit.ai",
      label: "Copilot Cloud",
      icon: CloudIcon,
      isExternal: true
    },
    {
      href: "/reference",
      label: "API Reference",
      icon: TerminalIcon,
      isActive: pathname.startsWith("/reference")
    }
  ];

  return (
    <div className="w-full bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6">
        <nav className="flex items-center justify-between h-16">
          {/* Logo Section */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold text-gray-900">CopilotKit</span>
              {/* Kite icon placeholder - you can replace with actual kite icon */}
              <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-blue-500 rounded-sm flex items-center justify-center">
                <span className="text-white text-xs font-bold">K</span>
              </div>
              <span className="text-sm text-gray-600">Docs</span>
            </div>
          </div>

          {/* Navigation Items */}
          <div className="flex items-center space-x-8">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  target={item.isExternal ? "_blank" : undefined}
                  rel={item.isExternal ? "noopener noreferrer" : undefined}
                  className={cn(
                    "flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    item.isActive
                      ? "text-purple-600 border-b-2 border-purple-600"
                      : "text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Search */}
          <div className="flex items-center">
            <button className="flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors">
              <SearchIcon className="w-4 h-4" />
              <span>Search</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}