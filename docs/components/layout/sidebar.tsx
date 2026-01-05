import { DocsLayoutProps } from "fumadocs-ui/layouts/docs"
import Separator from "../ui/sidebar/separator"
import Page from "../ui/sidebar/page"
import Folder from "../ui/sidebar/folder"
import IntegrationLink from "../ui/sidebar/integration-link"
import { OpenedFoldersProvider } from "@/lib/hooks/use-opened-folders"
import { INTEGRATION_ORDER } from "@/lib/integrations"

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
  if (node.type !== "folder") return false
  const url = node.index?.url || node.url
  if (!url) return false
  // Integration landing pages are at /{integration} (e.g., /langgraph)
  // Check if the URL matches a known integration ID
  const integrationId = url.replace(/^\//, "").split("/")[0]
  return INTEGRATION_ORDER.includes(integrationId as typeof INTEGRATION_ORDER[number])
}

const Sidebar = ({ pageTree }: { pageTree: DocsLayoutProps["tree"] }) => {
  const pages = pageTree.children

  return (
    <OpenedFoldersProvider>
      <aside
        id="nd-sidebar"
        className="w-full max-w-[260px] h-full border backdrop-blur-lg border-r-0 border-border bg-glass-background rounded-l-2xl pl-3 pr-1 flex flex-col"
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
    </OpenedFoldersProvider>
  )
}

export default Sidebar
