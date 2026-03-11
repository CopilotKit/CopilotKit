import { cn } from "@/lib/utils";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";

type Node = DocsLayoutProps["tree"]["children"][number];

interface SeparatorProps {
  node: Node;
  minimal?: boolean;
}

const Separator = ({ node, minimal = false }: SeparatorProps) => {
  return (
    <li className="flex gap-2 justify-between items-center mt-6 mb-3 w-full h-4 shrink-0">
      <span
        className={cn(
          "uppercase text-[10px] w-max shrink-0 text-sidebar-separator",
          minimal && "font-bold",
        )}
      >
        {node.name}
      </span>
      {!minimal && <div className="w-full h-px bg-foreground/10" />}
    </li>
  );
};

export default Separator;
