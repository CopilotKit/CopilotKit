"use client"

import { useState } from "react"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import Page from "./page"
import ChevronDownIcon from "../icons/chevron"
import { cn } from "@/lib/utils"

type Node = DocsLayoutProps["tree"]["children"][number]

interface FolderProps {
  node: Node
}

const Folder = ({ node }: FolderProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div>
      <li
        className="flex gap-2 justify-between items-center px-3 h-10 cursor-pointer shrink-0"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="w-max text-sm shrink-0">{node.name}</span>
        <ChevronDownIcon className={cn(isOpen ? "rotate-180" : "")} />
      </li>
      {isOpen && (
        <ul className="flex relative flex-col gap-2 ml-2">
          <div className="absolute top-1/2 -translate-y-1/2 left-0 w-px h-[calc(100%-8px)] bg-foreground/10" />

          {(node as { children: Node[] }).children.map((page) => (
            <Page key={crypto.randomUUID()} node={page} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default Folder
