import { useState } from "react";
import { cn, Icon } from "@mintlify/components";
import type { TabInfo } from "@mintlify/astro/helpers";

interface TabsDropdownProps {
  tabs: TabInfo[];
}

export function TabsDropdown({ tabs }: TabsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeTab = tabs.find((tab) => tab.isActive);

  if (tabs.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-2.5 h-10 rounded-[0.85rem] border border-gray-200/70 dark:border-gray-700/70 hover:bg-gray-600/5 dark:hover:bg-white/5 gap-1.5"
      >
        <span className="text-base font-normal text-gray-800 dark:text-gray-100">
          {activeTab?.name || tabs[0]?.name}
        </span>
        <Icon
          icon="chevron-down"
          iconLibrary="lucide"
          className={cn(
            "transition-transform text-gray-500 dark:text-gray-400",
            isOpen && "rotate-180",
          )}
          size={16}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-950 border border-gray-200/70 dark:border-gray-700/70 rounded-lg shadow-lg dark:shadow-black/50 p-1.5 z-20">
            {tabs.map((tab) => (
              <a
                key={tab.name}
                href={tab.href}
                className={cn(
                  "flex items-center justify-between px-2.5 py-2 text-sm font-medium rounded-md hover:bg-gray-100 dark:hover:bg-white/5",
                  tab.isActive
                    ? "text-primary"
                    : "text-gray-800 dark:text-gray-200",
                )}
                onClick={() => setIsOpen(false)}
              >
                {tab.name}
                {tab.isActive && (
                  <Icon
                    icon="check"
                    iconLibrary="lucide"
                    className="text-primary"
                    size={16}
                  />
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
