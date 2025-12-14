import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"

type Node = DocsLayoutProps["tree"]["children"][number]

interface SeparatorProps {
  node: Node
}

const Separator = ({ node }: SeparatorProps) => {
  return (
    <li className="flex gap-2 justify-between items-center mt-6 mb-3 w-full h-4 shrink-0">
      <span className="uppercase text-[10px] w-max shrink-0 text-sidebar-separator">
        {node.name}
      </span>
      <div className="w-full h-px bg-foreground/10" />
    </li>
  )
}

export default Separator
