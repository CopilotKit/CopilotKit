import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
// Components
import Navbar from "@/components/layout/navbar"
import { source } from "@/app/source"

export const baseOptions: BaseLayoutProps = {
  githubUrl: "https://github.com/copilotkit/copilotkit",
  nav: {
    component: <Navbar pageTree={source.pageTree} />,
  },
}
