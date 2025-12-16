import Link from "next/link"
import Image from "next/image"
import { ReactNode } from "react"
import type { PageTree } from "fumadocs-core/server"
import { Page } from "fumadocs-core/source"
import { ChevronRight } from "lucide-react"
import { ChevronLeft } from "lucide-react"

interface CustomPagerProps {
  tree: PageTree.Root
  page: Page
}

function cleanTree(tree: PageTree.Node[]): PageTree.Node[] {
  return tree.flatMap((node: PageTree.Node) => {
    if (node.type === "folder") {
      return [node, ...cleanTree(node.children as PageTree.Node[])]
    }
    if (node.type === "page") {
      return [node]
    }
    return []
  })
}

function getIndex(tree: PageTree.Node[], page: Page): number {
  return tree.findIndex((node) => {
    if (node.type === "folder") {
      return (node as PageTree.Folder).index?.$id === page.path
    }
    if (node.type === "page") {
      return (node as PageTree.Item).$id === page.path
    }
    return false
  })
}

function getPrev(
  tree: PageTree.Node[],
  pageIndex: number
): { url: string; title: string } | null {
  if (pageIndex <= 0) return null

  const prevItem = tree[pageIndex - 1]

  if (prevItem.type === "folder") {
    return {
      url: (prevItem as PageTree.Folder).index?.url as string,
      title: (prevItem as PageTree.Folder).index?.name?.toString() as string,
    }
  }
  return {
    url: (prevItem as PageTree.Item).url as string,
    title: (prevItem as PageTree.Item).name?.toString() as string,
  }
}

function getNext(
  tree: PageTree.Node[],
  pageIndex: number
): { url: string; title: string } | null {
  if (pageIndex === tree.length - 1) return null
  const nextItem = tree[pageIndex + 1]

  if (nextItem.type === "folder") {
    return {
      url: (nextItem as PageTree.Folder).index?.url as string,
      title: (nextItem as PageTree.Folder).index?.name?.toString() as string,
    }
  }
  return {
    url: (nextItem as PageTree.Item).url as string,
    title: (nextItem as PageTree.Item).name?.toString() as string,
  }
}

export function CustomPager({ tree, page }: CustomPagerProps): ReactNode {
  const cleanedTree = cleanTree(tree.children)
  const pageIndex = getIndex(cleanedTree, page)
  const prev = getPrev(cleanedTree, pageIndex)
  const next = getNext(cleanedTree, pageIndex)

  return (
    <div className="flex items-center justify-between pb-12 px-16 h-[76px] lg:h-20 shrink-0 box-content">
      <div className={`flex h-full ${prev ? "w-full" : "w-max"}`}>
        {prev ? (
          <Link
            href={prev?.url}
            className="flex flex-col gap-1 justify-center px-4 lg:px-5 w-full h-full rounded-2xl rounded-r-none border border-r-0 backdrop-blur-lg border-border bg-glass-background dark:!bg-[#01050780]"
          >
            <div className="flex gap-2 justify-start items-center">
              <ChevronLeft className="size-4 shrink-0 text-fd-muted-foreground" />
              <span className="text-xs font-medium text-left font-spline">
                PREV
              </span>
            </div>
            <span className="text-left">{prev.title}</span>
          </Link>
        ) : (
          <div className="w-11 h-full rounded-2xl rounded-r-none border border-r-0 backdrop-blur-lg border-border bg-glass-background dark:!bg-[#01050780]" />
        )}

        <Image
          src="/images/redirects/slanted-end-border-dark.svg"
          alt="Slanted start border"
          width={34}
          height={80}
          className="hidden shrink-0 dark:inline-block"
        />
        <Image
          src="/images/redirects/slanted-end-border-light.svg"
          alt="Slanted end border"
          width={34}
          height={80}
          className="shrink-0 dark:hidden"
        />
      </div>

      <div className={`flex -ml-3 h-full ${next ? "w-full" : "w-max"}`}>
        <Image
          src="/images/redirects/slanted-start-border-dark.svg"
          alt="Slanted start border"
          width={34}
          height={80}
          className="hidden shrink-0 dark:inline-block"
        />
        <Image
          src="/images/redirects/slanted-start-border-light.svg"
          alt="Slanted start border"
          width={34}
          height={80}
          className="shrink-0 dark:hidden"
        />

        {next ? (
          <Link
            href={next.url}
            className="flex flex-col gap-1 justify-center px-4 lg:px-5 w-full h-full rounded-2xl rounded-l-none border border-l-0 backdrop-blur-lg border-border bg-glass-background dark:!bg-[#01050780]"
          >
            <div className="flex gap-2 justify-end items-center">
              <span className="text-xs font-medium text-right font-spline">
                NEXT
              </span>
              <ChevronRight className="size-4 shrink-0 text-fd-muted-foreground" />
            </div>
            <span className="text-right">{next.title}</span>
          </Link>
        ) : (
          <div className="w-11 h-full rounded-2xl rounded-l-none border border-l-0 backdrop-blur-lg border-border bg-glass-background dark:!bg-[#01050780]" />
        )}
      </div>
    </div>
  )
}
