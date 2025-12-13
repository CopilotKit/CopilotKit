"use client"

import Link from "fumadocs-core/link"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string }

interface PageProps {
  node: Node
  onNavigate?: () => void
}

const Page = ({ node, onNavigate }: PageProps) => {
  const pathname = usePathname()
  const isActive = node.url === pathname

  return (
    <li
      className={cn(
        "flex justify-start items-center px-3 h-10 text-sm opacity-60 transition-all duration-300 shrink-0 hover:opacity-100 hover:bg-white dark:hover:bg-white/10 rounded-lg",
        isActive && "opacity-100 bg-white dark:bg-white/10"
      )}
    >
      <Link
        href={node.url}
        className="text-foreground dark:text-white"
        onClick={onNavigate}
      >
        {node.name}
      </Link>
    </li>
  )
}

export default Page
