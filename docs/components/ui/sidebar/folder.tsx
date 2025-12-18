"use client"

import { useState, useMemo } from "react"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import { usePathname, useRouter } from "next/navigation"
import Page from "./page"
import ChevronDownIcon from "../icons/chevron"
import { cn } from "@/lib/utils"

type Node = DocsLayoutProps["tree"]["children"][number] & { url: string }

interface FolderProps {
  node: Node & { index?: { url: string } }
  onNavigate?: () => void
}

const Folder = ({ node, onNavigate }: FolderProps) => {
  const [isOpen, setIsOpen] = useState<boolean | null>(null)
  const pathname = usePathname()
  const isActive = node?.index?.url === pathname
  const router = useRouter()
  const folderUrl = node.index?.url
  
  const shouldBeOpenFromPath = useMemo(() => {
    if (!folderUrl) return false
    return pathname.includes(folderUrl)
  }, [pathname, folderUrl])
  
  const isFolderOpen = isOpen !== null ? isOpen : shouldBeOpenFromPath

  const handleLinkClick = () => {
    if (isActive) return
    const newOpenState = !isOpen
    setIsOpen(newOpenState)
    router.push(folderUrl ?? "")
  }

  return (
    <div className="w-full">
      <li
        className={cn(
          "w-full shrink-0 opacity-60 transition-all duration-300 hover:opacity-100 hover:bg-white dark:hover:bg-white/10 rounded-lg",
          isActive && "opacity-100 bg-white dark:bg-white/10"
        )}
      >
        <button
          onClick={handleLinkClick}
          className="flex gap-2 justify-between items-center px-3 w-full h-10 cursor-pointer"
        >
          <span className="w-max text-sm shrink-0">{node.name}</span>
          <ChevronDownIcon className={cn(isFolderOpen ? "rotate-180" : "")} />
        </button>
      </li>
      {isFolderOpen && (
        <ul className="flex relative flex-col gap-2 ml-4">
          <div className="absolute top-1/2 -translate-y-1/2 -left-2 w-px h-[calc(100%-8px)] bg-foreground/10" />

          {(node as { children: Node[] }).children.map((page) => (
            <Page
              key={crypto.randomUUID()}
              node={page}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export default Folder
