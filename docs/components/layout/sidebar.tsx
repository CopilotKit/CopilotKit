import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import Separator from "../ui/sidebar/separator"
import Page from "../ui/sidebar/page"
import Folder from "../ui/sidebar/folder"
import IntegrationLink from "../ui/sidebar/integration-link"

type Node = DocsLayoutProps["tree"]["children"][number] & {
  url: string
  index?: { url: string }
}

const NODE_COMPONENTS = {
  separator: Separator,
  page: Page,
  folder: Folder,
  integrationLink: IntegrationLink,
}

const isIntegrationFolder = (node: Node): boolean => {
  return (
    node.type === "folder" && !!node.index?.url?.startsWith("/integrations/")
  )
}

const Sidebar = ({ pageTree }: { pageTree: DocsLayoutProps["tree"] }) => {
  const pages = pageTree.children

  return (
    <aside
      id="nd-sidebar"
      className="w-full max-w-[260px] h-[calc(100vh-64px-8px)] lg:h-[calc(100vh-80px-8px)] border backdrop-blur-lg border-r-0 border-border bg-glass-background rounded-l-2xl pl-3 pr-1 hidden md:block"
    >
      <ul className="flex overflow-y-auto flex-col pr-1 max-h-full custom-scrollbar">
        <li className="w-full h-6" />
        {pages.map((page) => {
          const nodeType = isIntegrationFolder(page as Node)
            ? "integrationLink"
            : page.type
          const Component = NODE_COMPONENTS[nodeType]
          return <Component key={crypto.randomUUID()} node={page as Node} />
        })}
      </ul>
    </aside>
  )
}

export default Sidebar
