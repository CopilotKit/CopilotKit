"use client"

import Link from "fumadocs-core/link"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string
  index?: { url: string }
}

interface IntegrationLinkProps {
  node: Node
}

const IntegrationLink = ({ node }: IntegrationLinkProps) => {
  const pathname = usePathname()
  const linkUrl = node.index?.url ?? ""
  const isActive = pathname.startsWith(linkUrl)

  return (
    <li
      className={cn(
        "flex justify-start items-center px-3 h-10 text-sm opacity-60 transition-opacity duration-300 shrink-0 hover:opacity-100 rounded-lg",
        isActive && "opacity-100 bg-white/10"
      )}
    >
      <Link href={linkUrl} className="text-foreground dark:text-white">
        {node.name}
      </Link>
    </li>
  )
}

export default IntegrationLink

