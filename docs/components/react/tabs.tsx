"use client";

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useEffect, useState } from 'react';

interface TabProps {
  value: string;
  children: React.ReactNode;
}

interface TabItem {
  value: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  items: (TabItem | string)[];
  children: React.ReactNode;
  defaultValue?: string;
  groupId?: string;
  persist?: boolean;
}

// Global state to sync tabs with the same groupId, bit hacky
const tabGroups: Record<string, Set<(value: string) => void>> = {};

export function Tabs({ items, children, defaultValue, groupId, persist, ...props }: TabsProps) {
  const normalizedItems = items.map(item => 
    typeof item === 'string' ? { value: item } : item
  );

  const [value, setValue] = useState<string>(() => {
    if (persist) {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(`tabs-${groupId || 'default'}`) : null;
      if (stored && normalizedItems.some(item => item.value === stored)) return stored;
    }
    return defaultValue || normalizedItems[0].value;
  });

  useEffect(() => {
    if (!groupId) return;

    // Create a Set for this group if it doesn't exist
    if (!tabGroups[groupId]) {
      tabGroups[groupId] = new Set();
    }

    // Add this instance's setValue to the group
    tabGroups[groupId].add(setValue);

    return () => {
      // Cleanup: remove this instance's setValue from the group
      tabGroups[groupId]?.delete(setValue);
      if (tabGroups[groupId]?.size === 0) {
        delete tabGroups[groupId];
      }
    };
  }, [groupId]);

  const handleValueChange = (newValue: string) => {
    setValue(newValue);

    // Update all other tabs in the same group
    if (groupId) {
      tabGroups[groupId]?.forEach(setValueFn => setValueFn(newValue));
    }

    // Persist to localStorage if enabled
    if (persist) {
      localStorage.setItem(`tabs-${groupId || 'default'}`, newValue);
    }
  };

  return (
    <TabsPrimitive.Root className="border rounded-md" value={value} onValueChange={handleValueChange} {...props}>
      <ScrollArea className="w-full rounded-md rounded-b-none relative bg-secondary dark:bg-secondary/40 border-b">
        <TabsPrimitive.List className="px-4 py-3 flex">
          {normalizedItems.map((item) => (
            <TabsPrimitive.Trigger
              key={item.value}
              value={item.value}
              className="relative px-3 mr-2 py-1 text-sm font-medium rounded-md whitespace-nowrap flex gap-2 items-center border text-primary
                hover:bg-indigo-200/80 dark:hover:bg-indigo-900/80
                bg-indigo-200/30 dark:bg-indigo-800/20
                border-black/20 dark:border-gray-500/50
                data-[state=active]:bg-indigo-200/80 dark:data-[state=active]:bg-indigo-800/50
                data-[state=active]:border-indigo-400 dark:data-[state=active]:border-indigo-400"
            >
              {item.icon && <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>}
              {item.value}
            </TabsPrimitive.Trigger>
          ))}
          <ScrollBar orientation="horizontal" className=""/>
        </TabsPrimitive.List>
      </ScrollArea>
      {children}
    </TabsPrimitive.Root>
  );
}

export function Tab({ value, children }: TabProps) {
  return (
    <TabsPrimitive.Content value={value} className="px-4">
      {children}
    </TabsPrimitive.Content>
  );
}