"use client";

import { ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  wrapperClassName?: string;
  navClassName?: string;
  buttonClassName?: string;
  activeButtonClassName?: string;
  inactiveButtonClassName?: string;
  contentClassName?: string;
}

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  wrapperClassName = "h-full bg-white flex flex-col rounded-lg shadow-sm",
  navClassName = "p-6 pb-0",
  buttonClassName = "w-1/2 py-4 text-base font-medium transition-all duration-200 text-center border-b",
  activeButtonClassName = "text-pink-600 border-pink-600",
  inactiveButtonClassName = "text-neutral-500 border-neutral-200 hover:text-neutral-700 hover:border-neutral-300",
  contentClassName = "p-6 overflow-y-auto flex-1",
}: TabsProps) {
  return (
    <div className={wrapperClassName}>
      <nav className={navClassName}>
        <div className="flex w-full">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`${buttonClassName} ${
                activeTab === id ? activeButtonClassName : inactiveButtonClassName
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <main className={contentClassName}>{tabs.find((tab) => tab.id === activeTab)?.content}</main>
    </div>
  );
}
