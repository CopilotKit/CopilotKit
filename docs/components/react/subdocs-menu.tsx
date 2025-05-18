"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSidebar } from "fumadocs-ui/provider";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { PiGraph } from "react-icons/pi";

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
  selectedStyle?: string;
  props?: HTMLAttributes<HTMLElement>;
}

export interface OptionDropdown {
  title: ReactNode;
  options: Option[];
}

function isOptionDropdown(
  item: Option | OptionDropdown
): item is OptionDropdown {
  return "options" in item;
}

function isOption(item: Option | OptionDropdown): item is Option {
  return !isOptionDropdown(item);
}

export function SubdocsMenu({
  options,
  ...props
}: {
  options: (Option | OptionDropdown)[];
} & HTMLAttributes<HTMLButtonElement>): React.ReactElement {
  const { closeOnRedirect } = useSidebar();
  const pathname = usePathname();
  const selected: Option | undefined = useMemo(() => {
    // First, try all non-root options
    let nonRootOptions = options.filter(
      (item) => isOption(item) && item.url !== "/"
    );

    const dropDowns = options.filter((item) => isOptionDropdown(item));

    if (dropDowns.length > 0) {
      const dropDown = dropDowns[0];
      nonRootOptions = nonRootOptions.concat(dropDown.options);
    }

    const activeNonRootOption = nonRootOptions.find(
      (item) => isOption(item) && isActive(item.url, pathname, true)
    );

    if (activeNonRootOption) {
      return activeNonRootOption as Option;
    }

    // If no non-root options are active, try the root options ("/*")
    return options.find(
      (item) => isOption(item) && isActive(item.url, pathname, true, true)
    ) as Option | undefined;
  }, [options, pathname]);

  const onClick = useCallback(() => {
    closeOnRedirect.current = false;
  }, [closeOnRedirect]);

  return (
    <div className="flex flex-col gap-2 border-b p-4">
      {options.map((item) => (
        <SubdocsMenuItem
          key={isOption(item) ? item.url : "dropdown"}
          item={item}
          selected={selected}
          onClick={onClick}
        />
      ))}
    </div>
  );
}

function SubdocsMenuItem({
  item,
  selected,
  onClick,
}: {
  item: Option | OptionDropdown;
  selected?: Option;
  onClick?: () => void;
}) {
  if (isOption(item)) {
    return (
      <Link
        key={item.url}
        href={item.url}
        onClick={onClick}
        {...item.props}
        className={cn(
          "p-2 flex flex-row gap-3 items-center cursor-pointer group opacity-60 hover:opacity-100",
          item.props?.className,
          selected === item && `${item.selectedStyle} opacity-100`
        )}
      >
        <div
          className={cn(
            "rounded-sm p-1.5",
            item.bgGradient,
            selected !== item && ""
          )}
        >
          {item.icon}
        </div>
        <div className="font-medium whitespace-pre-line">{item.title}</div>
      </Link>
    );
  } else if (isOptionDropdown(item)) {
    return (
      <SubdocsMenuItemDropdown
        item={item}
        selected={selected}
        onClick={onClick}
      />
    );
  }
}

function SubdocsMenuItemAgentFramework({
  item,
  selected,
  onClick,
}: {
  item: OptionDropdown;
  selected?: Option;
  onClick?: () => void;
}) {
  const defaultOption = item.options.find(
    (option) => option.url === "/coagents"
  )!;

  const isSelected = item.options.find(
    (option) => option.url === selected?.url
  );

  const showOption =
    item.options.find((option) => option.url === selected?.url) ||
    defaultOption;

  return (
    <Link
      key={showOption.url}
      href={showOption.url}
      onClick={onClick}
      {...showOption.props}
      className={cn(
        "p-2 flex flex-row gap-3 items-center cursor-pointer group opacity-60 hover:opacity-100",
        showOption.props?.className,
        isSelected && `${showOption.selectedStyle} opacity-100`
      )}
    >
      <div
        className={cn(
          "rounded-sm p-1.5",
          showOption.bgGradient,
          isSelected && ""
        )}
      >
        {showOption.icon}
      </div>
      <div className="font-medium whitespace-pre-line">{showOption.title}</div>
    </Link>
  );
}

function SubdocsMenuItemDropdown({
  item,
  selected,
  onClick,
}: {
  item: OptionDropdown;
  selected?: Option;
  onClick?: () => void;
}) {
  const router = useRouter();
  const selectRef = useRef(null);

  const selectedOption = item.options.find(
    (option) => option.url === selected?.url
  );

  const isSelected = selectedOption !== undefined;

  return (
    <div className="w-full">
      <Select
        onValueChange={(url) => {
          router.push(url);
          onClick?.();
          if (selectRef.current) {
            setTimeout(() => {
              (selectRef.current as any).blur();
            }, 10);
          }
        }}
        value={selectedOption?.url}
      >
        <SelectTrigger
          className={cn(
            "pl-2 py-2 border-0 h-auto flex gap-3 items-center w-full",
            isSelected
              ? `${
                  selectedOption?.selectedStyle ||
                  "ring-purple-500/70 ring-2 rounded-sm"
                } opacity-100`
              : "ring-0 opacity-60 hover:opacity-100"
          )}
          ref={selectRef}
        >
          <SelectValue
            placeholder={
              <div className="flex items-center">
                <div className={cn("rounded-sm p-1.5 mr-2")}>
                  {selectedOption?.icon || (
                    <PiGraph
                      className={cn(
                        "w-5 h-5 text-bold bg-gradient-to-b rounded-sm",
                        "from-purple-700 to-purple-400 text-purple-100 inline-block"
                      )}
                    />
                  )}
                </div>
                <div className="font-medium whitespace-pre-line">{item.title}</div>
              </div>
            }
          />
        </SelectTrigger>
        <SelectContent className="p-1">
          {item.options.map((option) => (
            <SelectItem
              key={option.url}
              value={option.url}
              className="py-2 px-2 cursor-pointer focus:bg-accent focus:text-accent-foreground"
            >
              <div className="flex items-center">
                <div className={cn("rounded-sm p-1.5 mr-2", option.bgGradient)}>
                  {option.icon}
                </div>
                <span className="font-medium whitespace-pre-line">{option.title}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
