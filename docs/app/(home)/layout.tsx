import { DocsLayout } from "fumadocs-ui/layout";
import type { ReactNode } from "react";
import { baseOptions } from "../layout.config";
import { source } from "@/app/source";
import { SubdocsMenu } from "@/components/react/subdocs-menu";
import { TerminalIcon, RocketIcon, Bot, UserCog } from "lucide-react";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { TopBar } from "@/components/layout/top-bar";
import { SiLangchain } from "react-icons/si";
import { AG2Icon, MastraIcon } from "@/lib/icons/custom-icons";
import { LuPlane } from "react-icons/lu";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <div className="pt-0"> {/* Remove extra padding at the top */}
        <DocsLayout
          tree={source.pageTree}
          {...baseOptions}
          sidebar={{
            hideSearch: true
          }}
        >
          {children}
        </DocsLayout>
      </div>
    </>
  );
}
