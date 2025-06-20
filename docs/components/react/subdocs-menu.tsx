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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PiGraph } from "react-icons/pi";
import { BoxesIcon } from "lucide-react";

// localStorage utilities for managing user's connection type preference
const STORAGE_KEY = "copilotkit-nav-preference";

function getStoredNavPreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredNavPreference(url: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // Ignore localStorage errors
  }
}

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

export interface Separator {
  type: 'separator';
}

export interface Label {
  type: 'label';
  text: string;
}

function isOptionDropdown(
  item: Option | OptionDropdown | Separator | Label
): item is OptionDropdown {
  return "options" in item;
}

function isOption(item: Option | OptionDropdown | Separator | Label): item is Option {
  return !isOptionDropdown(item) && !isSeparator(item) && !isLabel(item);
}

function isSeparator(item: Option | OptionDropdown | Separator | Label): item is Separator {
  return (item as Separator).type === 'separator';
}

function isLabel(item: Option | OptionDropdown | Separator | Label): item is Label {
  return (item as Label).type === 'label';
}

export function SubdocsMenu({
  options,
  ...props
}: {
  options: (Option | OptionDropdown | Separator | Label)[];
} & HTMLAttributes<HTMLButtonElement>): React.ReactElement {
  const { closeOnRedirect } = useSidebar();
  const pathname = usePathname();
  
  // State for tracking user's explicit navigation preference
  const [storedPreference, setStoredPreference] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load stored preference on mount
  useEffect(() => {
    const preference = getStoredNavPreference();
    setStoredPreference(preference);
    setIsInitialized(true);
  }, []);

  const selected: Option | undefined = useMemo(() => {
    // Don't calculate selection until we've loaded the stored preference
    if (!isInitialized) return undefined;

    // Get all available options for easier searching
    const allOptions = options.filter(isOption) as Option[];
    const dropDowns = options.filter((item) => isOptionDropdown(item)) as OptionDropdown[];
    let dropdownOptions: Option[] = [];

    if (dropDowns.length > 0) {
      const dropDown = dropDowns[0];
      dropdownOptions = dropDown.options;
    }

    // PRIORITY 1: Check if current pathname matches any option (highest priority)
    const activeDropdownOption = dropdownOptions.find(
      (item) => isActive(item.url, pathname, true)
    );
    if (activeDropdownOption) {
      return activeDropdownOption;
    }

    const activeMainOption = allOptions.find(
      (item) => isActive(item.url, pathname, true, item.url === "/")
    );
    if (activeMainOption) {
      return activeMainOption;
    }

    // PRIORITY 2: If no current pathname match, check stored preference
    if (storedPreference) {
      // Check if stored preference matches any main option
      const storedOption = allOptions.find(option => option.url === storedPreference);
      if (storedOption) {
        return storedOption;
      }
      
      // Check if stored preference matches any dropdown option
      const storedDropdownOption = dropdownOptions.find(option => option.url === storedPreference);
      if (storedDropdownOption) {
        return storedDropdownOption;
      }
    }

    // Default fallback
    return undefined;
  }, [options, pathname, storedPreference, isInitialized]);

  // Handle explicit upper nav clicks to store preference
  const handleExplicitNavClick = useCallback((url: string) => {
    setStoredNavPreference(url);
    setStoredPreference(url);
    closeOnRedirect.current = false;
  }, []);

  const onClick = useCallback(() => {
    closeOnRedirect.current = false;
  }, [closeOnRedirect]);

      return (
      <div className="flex flex-col gap-2 border-b p-4">
        {options.map((item, index) => {
          if (isSeparator(item)) {
            return <hr key={`separator-${index}`} className="my-2 border-t border-gray-700" />;
          } else if (isLabel(item)) {
            return (
              <div key={`label-${index}`} className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {item.text}
              </div>
            );
          } else {
            return (
              <SubdocsMenuItem
                key={isOption(item) ? item.url : "dropdown"}
                item={item}
                selected={selected}
                onClick={onClick}
                onExplicitClick={handleExplicitNavClick}
              />
            );
          }
        })}
      </div>
    );
}

function SubdocsMenuItem({
  item,
  selected,
  onClick,
  onExplicitClick,
}: {
  item: Option | OptionDropdown;
  selected?: Option;
  onClick?: () => void;
  onExplicitClick?: (url: string) => void;
}) {
  if (isOption(item)) {
    return (
      <Link
        key={item.url}
        href={item.url}
        onClick={() => {
          onClick?.();
          onExplicitClick?.(item.url);
        }}
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
        <div className="font-medium">{item.title}</div>
      </Link>
    );
  } else if (isOptionDropdown(item)) {
    return (
      <SubdocsMenuItemDropdown
        item={item}
        selected={selected}
        onClick={onClick}
        onExplicitClick={onExplicitClick}
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
      <div className="font-medium">{showOption.title}</div>
    </Link>
  );
}

function SubdocsMenuItemDropdown({
  item,
  selected,
  onClick,
  onExplicitClick,
}: {
  item: OptionDropdown;
  selected?: Option;
  onClick?: () => void;
  onExplicitClick?: (url: string) => void;
}) {
  const router = useRouter();
  const selectRef = useRef(null);
  const pathname = usePathname();

  const selectedOption = item.options.find(
    (option) => option.url === selected?.url
  );

  // Check if we're on a page that should reset the dropdown
  const topLevelPages = ["/", "/reference", "/quickstart"];
  const shouldResetDropdown = topLevelPages.some(page => 
    page === "/" ? pathname === "/" : pathname.startsWith(page)
  );

  const isSelected = selectedOption !== undefined && !shouldResetDropdown;

  return (
    <div className="w-full">
      <Select
        key={shouldResetDropdown ? "reset" : "normal"}
        onValueChange={(url) => {
          router.push(url);
          onClick?.();
          onExplicitClick?.(url);
          if (selectRef.current) {
            setTimeout(() => {
              (selectRef.current as any).blur();
            }, 10);
          }
        }}
        value={shouldResetDropdown ? undefined : selectedOption?.url}
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
                <div className={cn("rounded-sm p-1.5 mr-2", !selectedOption && "bg-gradient-to-b from-cyan-700 to-cyan-400 text-cyan-100")}>
                  {selectedOption?.icon || (
                    <BoxesIcon
                      className="w-4 h-4"
                      style={{ fontSize: '16px', width: '16px', height: '16px' }}
                    />
                  )}
                </div>
                <div className="font-medium">{item.title}</div>
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
                <span className="font-medium">{option.title}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
