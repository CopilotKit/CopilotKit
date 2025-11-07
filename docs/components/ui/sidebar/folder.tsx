"use client"

import { useEffect, useState } from "react"
import Link from "fumadocs-core/link"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import { usePathname } from "next/navigation"
import Page from "./page"
import ChevronDownIcon from "../icons/chevron"
import { cn } from "@/lib/utils"

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string }

interface FolderProps {
  node: Node & { index?: { url: string } }
}

const Folder = ({ node }: FolderProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const isActive = node?.index?.url === pathname

  useEffect(() => {
    if (!node.index?.url) return
    const isFolderAlreadyOpen = pathname.includes(node.index?.url)
    setIsOpen(isFolderAlreadyOpen)
  }, [node.index?.url])

  return (
    <div className="w-full">
      <li
        className={cn(
          "w-full shrink-0 opacity-60 transition-opacity duration-300 hover:opacity-100 rounded-lg",
          isActive && "opacity-100 bg-white/10"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Link
          href={node.index?.url}
          className="flex gap-2 justify-between items-center px-3 w-full h-10"
        >
          <span className="w-max text-sm shrink-0">{node.name}</span>
          <ChevronDownIcon className={cn(isOpen ? "rotate-180" : "")} />
        </Link>
      </li>
      {isOpen && (
        <ul className="flex relative flex-col gap-2 ml-4">
          <div className="absolute top-1/2 -translate-y-1/2 -left-2 w-px h-[calc(100%-8px)] bg-foreground/10" />

          {(node as { children: Node[] }).children.map((page) => (
            <Page key={crypto.randomUUID()} node={page} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default Folder
