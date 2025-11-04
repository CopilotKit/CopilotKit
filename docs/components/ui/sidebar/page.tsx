import Link from "fumadocs-core/link"
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"

type Node = DocsLayoutProps["tree"]["children"][number]

interface PageProps {
  node: Node
}

const Page = ({ node }: PageProps) => {
  return (
    <li className="flex justify-start items-center px-3 h-10 text-sm shrink-0">
      <Link href={node.url}>{node.name}</Link>
    </li>
  )
}

export default Page
