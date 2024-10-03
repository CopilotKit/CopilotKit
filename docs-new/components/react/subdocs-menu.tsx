"use client";
import { ChevronDown } from "lucide-react";
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSidebar } from "fumadocs-ui/provider";

export function isActive(
  url: string,
  pathname: string,
  nested = true,
  root = false
): boolean {
  const isActive =
    url === pathname || (nested && pathname.startsWith(root ? url : `${url}/`));
  return isActive;
}

export interface Option {
  /**
   * Redirect URL of the folder, usually the index page
   */
  url: string;

  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  bgGradient: string;
  selectedBorder: string;
  props?: HTMLAttributes<HTMLElement>;
}

export function SubdocsMenu({
  options,
  ...props
}: {
  options: Option[];
} & HTMLAttributes<HTMLButtonElement>): React.ReactElement {
  const { closeOnRedirect } = useSidebar();
  const pathname = usePathname();
  const selected = useMemo(() => {
    // First, try all non-root options
    const nonRootOptions = options.filter((item) => item.url !== "/");
    const activeNonRootOption = nonRootOptions.find((item) =>
      isActive(item.url, pathname, true)
    );

    if (activeNonRootOption) {
      return activeNonRootOption;
    }

    // If no non-root options are active, try the root options ("/*")
    return options.find((item) => isActive(item.url, pathname, true, true));
  }, [options, pathname]);

  const onClick = useCallback(() => {
    closeOnRedirect.current = false;
  }, [closeOnRedirect]);

  return (
    <div className="flex flex-col gap-2 border-b pb-4 pt-2 px-1">
      {options.map((item) => (
        <Link
          key={item.url}
          href={item.url}
          onClick={onClick}
          {...item.props}
          className={cn(
            "p-1 flex flex-row gap-3 items-center cursor-pointer group opacity-70 hover:opacity-100",
            selected === item && "opacity-100",
            item.props?.className
          )}
        >
          <div
            className={cn(
              "rounded-sm p-1.5",
              item.bgGradient,
              selected !== item && "",
              selected === item && `${item.selectedBorder} ring-2`
            )}
          >
            {item.icon}
          </div>
          <div className="font-medium">{item.title}</div>
        </Link>
      ))}
    </div>
  );
}
