"use client"

import Link from "fumadocs-core/link"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string }

interface PageProps {
  node: Node
}

const Page = ({ node }: PageProps) => {
  const pathname = usePathname()
  const isActive = node.url === pathname

  return (
    <li
      className={cn(
        "flex justify-start items-center px-3 h-10 text-sm opacity-60 transition-opacity duration-300 shrink-0 hover:opacity-100 rounded-lg",
        isActive && "opacity-100 bg-white/10"
      )}
    >
      <Link href={node.url} className="text-foreground dark:text-white">
        {node.name}
      </Link>
    </li>
  )
}

export default Page
