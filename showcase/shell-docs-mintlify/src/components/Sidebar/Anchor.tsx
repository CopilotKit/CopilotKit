import { cn, Icon } from "@mintlify/components";
import type { AnchorItem } from "./types";

export function Anchor({ name, href, icon, color }: AnchorItem) {
  const isExternal =
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//");

  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      style={
        { "--anchor-color": color || "var(--primary)" } as React.CSSProperties
      }
      className={cn(
        "group flex items-center ml-4 lg:ml-0 lg:text-sm lg:leading-6 mb-5 sm:mb-4 font-medium outline-offset-4",
        "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
      )}
    >
      {icon && (
        <span
          className={cn(
            "mr-4 rounded-md inline-flex items-center justify-center w-6 h-6 p-1",
            "group-hover:[background:var(--anchor-color)] ring-1 ring-gray-950/[0.07] dark:ring-white/10",
          )}
        >
          <Icon
            icon={icon}
            className="bg-gray-600 group-hover:bg-white dark:bg-gray-300 dark:group-hover:bg-white"
            overrideColor
            size={16}
          />
        </span>
      )}
      {name}
    </a>
  );
}
