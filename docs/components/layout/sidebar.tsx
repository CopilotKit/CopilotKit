import Link from "fumadocs-core/link"

interface SidebarCategory {
  label: string
  links: SidebarLink[]
}

interface SidebarLink {
  label: string
  href: string
  icon?: string
  links?: SidebarLink[]
}

const LINKS: SidebarCategory[] = [
  {
    label: "Get Started",
    links: [
      { label: "Introduction", href: "/direct-to-llm" },
      { label: "Vibe Coding MCP", href: "/direct-to-llm/vibe-coding-mcp" },
    ],
  },
  {
    label: "Feature Overviews",
    links: [
      {
        label: "Agentic Chat UI",
        href: "/direct-to-llm/guides/agentic-chat-ui",
      },
    ],
  },
]

const Sidebar = () => {
  return (
    <aside
      id="nd-sidebar"
      className="w-full max-w-[260px] h-[calc(100vh-64px-8px)] lg:h-[calc(100vh-80px-8px)] border backdrop-blur-lg border-r-0 border-border bg-glass-background rounded-l-2xl py-6 px-3 hidden md:block"
    >
      <ul className="flex flex-col gap-6 custom-scrollbar">
        {LINKS.map((category) => (
          <li key={category.label}>
            <span className="uppercase text-[10px]">{category.label}</span>
            <ul className="flex flex-col gap-2">
              {category.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export default Sidebar
