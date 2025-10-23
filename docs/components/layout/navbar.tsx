"use client"

import Link from "fumadocs-core/link"
import { usePathname } from "next/navigation"
import { PuzzleIcon, RocketIcon, TerminalIcon, CloudIcon } from "lucide-react"
import { Logo } from "@/app/logo"

const LINKS = [
  {
    icon: <RocketIcon className="w-4 h-4" />,
    label: "Overview",
    href: "/",
  },
  {
    icon: <PuzzleIcon className="w-4 h-4" />,
    label: "Integrations",
    href: "/integrations",
  },
  {
    icon: <TerminalIcon className="w-4 h-4" />,
    label: "API Reference",
    href: "/reference",
  },
  {
    icon: <CloudIcon className="w-4 h-4" />,
    label: "Copilot Cloud",
    href: "https://cloud.copilotkit.ai",
    target: "_blank",
  },
]

const Navbar = () => {
  const pathname = usePathname()
  const activeRoute = pathname.split("/")[1] || "/"

  return (
    <div className="h-[64px] lg:h-[80px] p-1 lg:p-2 fixed top-0 left-0 right-0 z-50">
      <div className="flex justify-between items-center w-full h-full rounded-2xl border border-white/10 bg-white/5">
        <div className="flex gap-11 items-center h-full">
          <Logo className="pl-6" />
          <ul className="hidden gap-6 items-center h-full lg:flex">
            {LINKS.map((link) => (
              <li key={link.href} className="relative h-full">
                <Link href={link.href} className="h-full">
                  <span className="flex gap-2 items-center h-full">
                    {link.icon} {link.label}
                  </span>
                </Link>
                {activeRoute === link.href && (
                  <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#7076D5]" />
                )}
              </li>
            ))}
          </ul>
        </div>

        <div></div>
      </div>
    </div>
  )
}

export default Navbar
