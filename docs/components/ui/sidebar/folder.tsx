"use client"

import { useEffect, useState } from "react"
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
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const isActive = node?.index?.url === pathname
  const router = useRouter()

  useEffect(() => {
    if (!node.index?.url) return
    const isFolderAlreadyOpen = pathname.includes(node.index?.url)
    setIsOpen(isFolderAlreadyOpen)
  }, [node.index?.url])

  useEffect(() => {
    if (!isActive && !pathname.includes(node.index?.url ?? "")) setIsOpen(false)
  }, [isActive, pathname])

  const handleLinkClick = () => {
    if (isActive) return
    setIsOpen(!isOpen)
    router.push(node.index?.url ?? "")
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
          <ChevronDownIcon className={cn(isOpen ? "rotate-180" : "")} />
        </button>
      </li>
      {isOpen && (
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
