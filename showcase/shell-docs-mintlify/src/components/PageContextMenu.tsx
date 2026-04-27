import { useState } from "react";
import { Icon, cn } from "@mintlify/components";
import {
  useContextualOptions,
  type ContextualOptionItem,
} from "../hooks/useContextualOptions";

type CopyState = "idle" | "copying" | "copied" | "error";

interface PageContextMenuProps {
  pathname: string;
  options?: string[];
  className?: string;
}

export function PageContextMenu({
  pathname,
  options: configOptions,
  className,
}: PageContextMenuProps) {
  const markdownPath = pathname === "/" ? "/index" : pathname;

  const { options } = useContextualOptions({
    pathname: markdownPath,
    options: configOptions,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  if (!options.length) return null;

  const handleAction = async (option: ContextualOptionItem) => {
    setIsOpen(false);
    if (option.id === "copy") {
      setCopyState("copying");
      try {
        const result = await option.action();
        setCopyState(result === false ? "error" : "copied");
      } catch {
        setCopyState("error");
      }
      setTimeout(() => setCopyState("idle"), 2000);
    } else {
      option.action();
    }
  };

  const copyText =
    copyState === "copying"
      ? "Copying..."
      : copyState === "copied"
        ? "Copied!"
        : copyState === "error"
          ? "Error"
          : "Copy page";

  const firstOption = options[0];

  return (
    <div className={cn("relative flex items-center shrink-0", className)}>
      <div className="flex items-stretch h-9 relative z-20">
        {firstOption && (
          <button
            className={cn(
              "rounded-l-xl px-3 text-stone-700 dark:text-stone-200 border border-stone-200 dark:border-stone-700 bg-white dark:bg-zinc-950 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors h-full",
              options.length === 1 ? "rounded-xl" : "border-r-0",
              copyState !== "idle" && "text-stone-600 dark:text-stone-300",
            )}
            onClick={() => void handleAction(firstOption)}
            disabled={copyState === "copying"}
            aria-label={firstOption.title}
          >
            <div className="flex items-center gap-2 text-sm font-medium whitespace-nowrap">
              {firstOption.icon && (
                <firstOption.icon className="w-4 h-4 text-stone-600 dark:text-stone-300" />
              )}
              <span>
                {firstOption.id === "copy" ? copyText : firstOption.title}
              </span>
            </div>
          </button>
        )}
        {options.length > 1 && (
          <button
            className="rounded-r-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-zinc-950 hover:bg-stone-50 dark:hover:bg-zinc-800 aspect-square h-full flex items-center justify-center transition-colors"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="More actions"
          >
            <Icon
              icon="chevron-down"
              iconLibrary="lucide"
              size={16}
              color="currentColor"
              className={cn(
                "transition-transform text-stone-400 dark:text-stone-500",
                isOpen && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
      {isOpen && options.length > 1 && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="rounded-2xl absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-auto min-w-[280px] sm:w-64 bg-white dark:bg-zinc-950 border border-stone-200 dark:border-stone-700 shadow-lg dark:shadow-black/50 z-20 overflow-hidden">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => void handleAction(option)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-50 dark:hover:bg-zinc-800 text-left"
              >
                <div className="border border-stone-200 dark:border-stone-700 rounded-md p-1.5">
                  {option.icon && (
                    <option.icon className="w-4 h-4 text-stone-500 dark:text-stone-300" />
                  )}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="text-sm font-medium text-stone-800 dark:text-stone-100 flex items-center gap-1">
                    {option.title}
                    {option.externalLink && (
                      <Icon
                        icon="arrow-up-right"
                        iconLibrary="lucide"
                        size={12}
                        color="currentColor"
                        className="text-stone-500 dark:text-stone-400"
                      />
                    )}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400 mt-0.5">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
