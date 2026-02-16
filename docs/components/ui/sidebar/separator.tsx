import { cn } from "@/lib/utils";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";

type Node = DocsLayoutProps["tree"]["children"][number];

interface SeparatorProps {
  node: Node;
  minimal?: boolean;
}

const Separator = ({ node, minimal = false }: SeparatorProps) => {
  return (
    <li className="mt-6 mb-3 flex h-4 w-full shrink-0 items-center justify-between gap-2">
      <span
        className={cn(
          "uppercase text-[10px] w-max shrink-0 text-sidebar-separator",
          minimal && "font-bold",
        )}
      >
        {node.name}
      </span>
      {!minimal && <div className="bg-foreground/10 h-px w-full" />}
    </li>
  );
};

export default Separator;
