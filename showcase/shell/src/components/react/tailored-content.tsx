"use client";

import React, {
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Local className-joining helper so this component has no external dep.
// Mirrors the subset of `classnames` behavior used below (strings + falsy values).
function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type TailoredContentOptionProps = {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  id: string;
};

/**
 * Declarative child marker for `TailoredContent`. This component intentionally
 * renders nothing; the parent reads its props (including `children`) directly
 * and renders the selected option's content itself.
 */
export function TailoredContentOption(_props: TailoredContentOptionProps) {
  return null;
}

type TailoredContentProps = {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  defaultOptionIndex?: number;
  id: string;
};

type IconElement = React.ReactElement<{ className?: string }>;

function TailoredContentInner({
  children,
  className,
  defaultOptionIndex = 0,
  id,
  header,
}: TailoredContentProps) {
  // All hooks must run unconditionally to satisfy the Rules of Hooks.
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabRefs = useRef<Array<HTMLDivElement | null>>([]);
  const warnedKeyRef = useRef<string | null>(null);

  // Memoize derived arrays so downstream hook deps have stable identities.
  const options = useMemo(
    () =>
      React.Children.toArray(children).filter((child) =>
        React.isValidElement(child),
      ) as React.ReactElement<TailoredContentOptionProps>[],
    [children],
  );
  const optionIds = useMemo(
    () => options.map((option) => option.props.id),
    [options],
  );

  // Warn (dev-mode friendly) when duplicate option ids would cause ambiguous
  // URL <-> selection mapping. Runs only when ids change; warnedKeyRef guards
  // against duplicate warns for the same set (e.g. StrictMode double-invoke).
  useEffect(() => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const oid of optionIds) {
      if (seen.has(oid) && !duplicates.includes(oid)) {
        duplicates.push(oid);
      }
      seen.add(oid);
    }
    if (duplicates.length === 0) return;
    const warnKey = duplicates.join(",");
    if (warnedKeyRef.current === warnKey) return;
    warnedKeyRef.current = warnKey;
    // eslint-disable-next-line no-console
    console.warn(
      `TailoredContent(id=${id}): duplicate option id(s) detected: ${duplicates
        .map((d) => `"${d}"`)
        .join(", ")}. Option ids must be unique.`,
    );
  }, [optionIds, id]);

  const updateSelection = useCallback(
    (index: number) => {
      if (index < 0 || index >= options.length) return;
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set(id, optionIds[index]);
      // Update URL without reload; derived selectedIndex will follow.
      router.replace(`?${newParams.toString()}`, { scroll: false });
    },
    [router, searchParams, id, optionIds, options.length],
  );

  // No hooks below this point — safe to short-circuit when there are no options.
  if (options.length === 0) return null;

  // Clamp defaultOptionIndex to the valid range.
  const clampedDefault = Math.min(
    Math.max(0, defaultOptionIndex),
    options.length - 1,
  );

  // Derive selectedIndex from the URL on every render so state stays in sync
  // with navigation (back/forward, external updates to the search param).
  const urlParam = searchParams.get(id);
  const indexFromUrl = urlParam ? optionIds.indexOf(urlParam) : -1;
  const selectedIndex = indexFromUrl >= 0 ? indexFromUrl : clampedDefault;

  const focusTab = (index: number) => {
    const el = tabRefs.current[index];
    if (el) el.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    switch (e.key) {
      case "Enter":
      case " ":
      case "Spacebar":
        e.preventDefault();
        updateSelection(index);
        return;
      case "ArrowRight": {
        e.preventDefault();
        const next = (index + 1) % options.length;
        updateSelection(next);
        focusTab(next);
        return;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const prev = (index - 1 + options.length) % options.length;
        updateSelection(prev);
        focusTab(prev);
        return;
      }
      case "Home": {
        e.preventDefault();
        updateSelection(0);
        focusTab(0);
        return;
      }
      case "End": {
        e.preventDefault();
        const last = options.length - 1;
        updateSelection(last);
        focusTab(last);
        return;
      }
      default:
        return;
    }
  };

  const itemCn =
    "border p-4 rounded-md flex-1 flex md:block md:space-y-1 items-center md:items-start gap-4 cursor-pointer bg-white dark:bg-secondary relative overflow-hidden group transition-all";
  const selectedCn =
    "shadow-lg ring-1 ring-indigo-400 selected bg-gradient-to-r from-indigo-100/80 to-purple-200 dark:from-indigo-900/20 dark:to-purple-900/30";
  const iconCn =
    "w-10 h-10 mb-4 top-0 transition-all opacity-20 group-[.selected]:text-indigo-500 group-[.selected]:opacity-60 dark:group-[.selected]:text-indigo-400 dark:group-[.selected]:opacity-60 dark:text-gray-400";

  const tablistId = `tailored-content-tablist-${id}`;
  const tabId = (optId: string) => `tailored-content-tab-${id}-${optId}`;
  const panelId = (optId: string) => `tailored-content-panel-${id}-${optId}`;

  const selectedOption = options[selectedIndex];

  return (
    <div>
      <div className={cn("tailored-content-wrapper mt-4", className)}>
        {header}
        <div
          id={tablistId}
          role="tablist"
          aria-orientation="horizontal"
          className="flex flex-col md:flex-row gap-3 my-2 w-full"
        >
          {options.map((option, index) => {
            const isSelected = selectedIndex === index;
            return (
              <div
                key={option.props.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={tabId(option.props.id)}
                className={cn(itemCn, isSelected && selectedCn)}
                onClick={() => updateSelection(index)}
                onKeyDown={(e) => onKeyDown(e, index)}
                role="tab"
                aria-selected={isSelected}
                aria-controls={panelId(option.props.id)}
                tabIndex={isSelected ? 0 : -1}
              >
                <div className="my-0">
                  {React.isValidElement(option.props.icon) ? (
                    (() => {
                      const icon = option.props.icon as IconElement;
                      return React.cloneElement(icon, {
                        className: cn(icon.props?.className, iconCn, "my-0"),
                      });
                    })()
                  ) : (
                    <span className={cn(iconCn, "my-0")} />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-lg">{option.props.title}</p>
                  <p className="text-xs md:text-sm">
                    {option.props.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {selectedOption && (
        <div
          role="tabpanel"
          id={panelId(selectedOption.props.id)}
          aria-labelledby={tabId(selectedOption.props.id)}
        >
          {selectedOption.props.children}
        </div>
      )}
    </div>
  );
}

/**
 * `TailoredContent` renders a set of tab-like options and the currently
 * selected option's content. The selection is persisted in the URL via
 * `?<id>=<optionId>` so links are shareable.
 *
 * Next.js App Router requires `useSearchParams()` to be wrapped in a
 * `<Suspense>` boundary. The exported component wraps the inner
 * implementation so consumers don't need to do that themselves.
 */
export function TailoredContent(props: TailoredContentProps) {
  return (
    <Suspense fallback={null}>
      <TailoredContentInner {...props} />
    </Suspense>
  );
}
