import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { TopNav } from "@/components/layout/top-nav";
import { TerminalIcon, RocketIcon, CloudIcon } from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { SiLangchain } from "react-icons/si";
import {
  AG2Icon,
  MastraIcon,
  AgnoIcon,
  LlamaIndexIcon,
  PydanticAIIcon,
} from "@/lib/icons/custom-icons";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      searchToggle={{ enabled: false }}
      sidebar={{
        tabs: false,
        banner: null,
      }}
      {...baseOptions}
    >
      <TopNav />
      {children}
    </DocsLayout>
  );
}
