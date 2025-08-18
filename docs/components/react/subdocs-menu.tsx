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

// Utility function to handle navigation scrolling
function handleNavigationScroll(fromPath: string, toPath: string) {
  // Check if this is an integration switch (different top-level path)
  const fromIntegration = fromPath.split('/')[1];
  const toIntegration = toPath.split('/')[1];
  const isIntegrationSwitch = fromIntegration !== toIntegration && toPath !== "/";
  
  // For both integration switches and internal navigation, scroll the main page to top
  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, 100);
}

// Utility function to scroll sidebar to selected item
function scrollSidebarToSelectedItem(targetPath?: string) {
  setTimeout(() => {
    const normalize = (p?: string) => {
      if (!p) return '';
      try {
        // Ensure we compare pathname only, strip query/hash and trailing slash
        const url = p.startsWith('http') ? new URL(p) : new URL(p, window.location.origin);
        let path = url.pathname;
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        return path;
      } catch {
        // Fallback for relative like ./generative-ui
        let path = p.split('?')[0].split('#')[0];
        if (path.startsWith('./')) path = path.slice(1);
        if (!path.startsWith('/')) {
          // Resolve against current path
          const base = window.location.pathname.replace(/\/$/, '');
          path = `${base}/${path}`.replace(/\/+/g, '/');
        }
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        return path;
      }
    };

    const target = normalize(targetPath || window.location.pathname);

    // Gather all anchors and find best match
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const candidates = anchors.filter(a => {
      const hrefNorm = normalize(a.href);
      return hrefNorm === target || hrefNorm === `${target}/` || hrefNorm.endsWith(target) || hrefNorm.endsWith(`${target}/`);
    });

    let selectedEl: HTMLElement | null = null;

    if (candidates.length > 0) {
      // Prefer the one closest to the left (likely the sidebar)
      candidates.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      selectedEl = candidates[0];
    }

    // Fallbacks based on aria-current or data attributes
    if (!selectedEl) {
      selectedEl = (document.querySelector('a[aria-current="page"]') || document.querySelector('[data-active="true"]')) as HTMLElement | null;
    }

    if (!selectedEl) return;

    // Find nearest scrollable ancestor
    function getScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
        if (canScroll) return node;
        node = node.parentElement as HTMLElement | null;
      }
      return null;
    }

    const container = getScrollableAncestor(selectedEl) || document.querySelector('aside, nav') as HTMLElement | null;

    if (container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = selectedEl.getBoundingClientRect();

      const currentScrollTop = container.scrollTop;
      const offsetTop = (elRect.top - containerRect.top) + currentScrollTop;
      const targetScrollTop = Math.max(0, offsetTop - (container.clientHeight / 2) + (selectedEl.offsetHeight / 2));

      container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    } else if ('scrollIntoView' in selectedEl) {
      selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }, 350); // allow DOM/route transition
}

// Global navigation handler for use with any link
export function useNavigationScroll() {
  const pathname = usePathname();
  
  return (toPath: string) => {
    handleNavigationScroll(pathname, toPath);
    scrollSidebarToSelectedItem(toPath);
  };
}

// Custom Link component for MDX content with navigation scrolling
export function NavigationLink({ 
  href, 
  children, 
  className, 
  ...props 
}: { 
  href: string; 
  children: React.ReactNode; 
  className?: string;
  [key: string]: any;
}) {
  const handleScroll = useNavigationScroll();
  const pathname = usePathname();

  // Convert absolute links that point within the same integration to relative
  const normalizeHref = (input: string): string => {
    if (!input || typeof input !== 'string') return input;
    if (!input.startsWith('/')) return input; // already relative or external
    const currentTop = (pathname.split('/')[1] || '').trim();
    const targetTop = (input.split('/')[1] || '').trim();
    if (currentTop && targetTop && currentTop === targetTop) {
      const rest = input.split('/').slice(2).join('/');
      return rest ? `./${rest}` : './';
    }
    return input;
  };

  const renderedHref = normalizeHref(href);
  
  return (
    <Link
      href={renderedHref}
      onClick={() => {
        // Use absolute path for scroll logic
        const absoluteTarget = href;
        handleScroll(absoluteTarget);
      }}
      className={className}
      {...props}
    >
      {children}
    </Link>
  );
}

export function isActive(
  url: string,
  pathname: string,
  nested = true,
  root = false
): boolean {
  // Exact match
  if (url === pathname) return true;
  
  // For nested matching
  if (nested) {
    // Special handling for root URL
    if (root && url === "/") {
      return pathname === "/";
    }
    
    // For non-root URLs, check if pathname starts with the URL followed by a slash
    // This ensures /direct-to-llm/guides/quickstart matches /direct-to-llm/guides/frontend-actions
    if (url !== "/" && pathname.startsWith(`${url}/`)) {
      return true;
    }
    
    // Special case for direct-to-llm: if the option URL is /direct-to-llm/guides/quickstart
    // and the current path is anywhere under /direct-to-llm/, consider it active
    if (url.includes('/direct-to-llm/') && pathname.startsWith('/direct-to-llm/')) {
      return true;
    }
  }
  
  return false;
}

export interface Option {
  /**
   * Redirect URL of the folder, usually the index page
   */
  url: string;
  /**
   * External link URL
   */
  href?: string;
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
  const [previousPath, setPreviousPath] = useState<string | null>(null);

  // Load stored preference on mount
  useEffect(() => {
    const preference = getStoredNavPreference();
    setStoredPreference(preference);
    setIsInitialized(true);
  }, []);

  // Handle navigation changes from external sources (browser back/forward) and any route change
  useEffect(() => {
    handleNavigationScroll(previousPath || pathname, pathname);
    scrollSidebarToSelectedItem(pathname);
    setPreviousPath(pathname);
  }, [pathname, previousPath]);

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
    //closeOnRedirect.current = false;
  }, []);

  const onClick = useCallback(() => {
    //closeOnRedirect.current = false;
  }, [closeOnRedirect]);

      return (
      <div className="flex flex-col gap-2">
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
        <hr className="mt-1 border-t border-primary/40" />
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
  const pathname = usePathname();
  
  if (isOption(item)) {
    return (
      <Link
        key={item.url}
        href={item.url}
        onClick={() => {
          if (item.href) {
            window.open(item.href, '_blank');
            return;
          }
          handleNavigationScroll(pathname, item.url);
          scrollSidebarToSelectedItem(item.url); // Scroll sidebar to selected item
          onClick?.();
          onExplicitClick?.(item.url);
        }}
        {...item.props}
        className={cn(
          "p-1 rounded-xl flex flex-row gap-3 items-center cursor-pointer group opacity-60 hover:opacity-100",
          item.props?.className,
          selected === item && `opacity-100 bg-primary/10 text-primary`
        )}
      >
        <div
          className={cn(
            "rounded-sm p-1.5 pr-0 text-primary",
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
  const topLevelPages = ["/", "/reference"];
  const shouldResetDropdown = topLevelPages.some(page => 
    page === "/" ? pathname === "/" : pathname.startsWith(page)
  );

  const isSelected = selectedOption !== undefined && !shouldResetDropdown;

  return (
    <div className="w-full">
      <Select
        key={shouldResetDropdown ? "reset" : "normal"}
        onValueChange={(url) => {
          handleNavigationScroll(pathname, url);
          scrollSidebarToSelectedItem(url); // Scroll sidebar to selected item
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
            "pl-1 py-1 border-0 h-auto flex gap-3 items-center w-full shadow-none rounded-xl cursor-pointer",
            isSelected && "bg-primary/10 text-primary"
          )}
          ref={selectRef}
        >
          <SelectValue
            placeholder={
              <div className="flex items-center">
                <div className={cn("rounded-sm mr-2 pl-1 pr-1.5 text-primary/50")}>
                  {selectedOption?.icon || (
                    <BoxesIcon
                      className="w-4 h-4"
                      style={{ fontSize: '16px', width: '16px', height: '16px' }}
                    />
                  )}
                </div>
                <div className={cn("font-medium", !isSelected && "text-muted-foreground hover:text-foreground")}>{item.title}</div>
              </div>
            }
          />
        </SelectTrigger>
        <SelectContent className="p-1 rounded-2xl max-h-[800px] shadow-lg">
          {item.options.map((option) => (
            <SelectItem
              key={option.url}
              value={option.url}
              className="pl-1 py-1 my-1 border-0 h-auto flex gap-3 items-center w-full shadow-none rounded-xl cursor-pointer hover:bg-secondary/10"
            >
              <div className="flex items-center">
                <div className={cn("rounded-sm p-1.5 mr-2 text-primary")}>
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