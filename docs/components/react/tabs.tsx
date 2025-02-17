"use client";

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useRouter, useSearchParams } from 'next/navigation';

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
  groupId: string;
  persist?: boolean;
}

// Global state to sync tabs with the same groupId
const tabGroups: Record<string, Set<(value: string) => void>> = {};

const getStorageKey = (groupId: string) => `copilotkit-tabs-${groupId}`;

export function Tabs({ items, children, defaultValue, groupId, persist, ...props }: TabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const normalizedItems = items.map(item => 
    typeof item === 'string' ? { value: item } : item
  );

  // Initialize value from URL or default
  const [value, setValue] = React.useState(() => {
    // First try URL
    const urlValue = searchParams.get(groupId);
    if (urlValue && normalizedItems.some(item => item.value === urlValue)) {
      return urlValue;
    }

    // Then try localStorage if persist is enabled
    if (persist && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(getStorageKey(groupId));
        if (stored && normalizedItems.some(item => item.value === stored)) {
          return stored;
        }
      } catch (e) {
        console.warn('Failed to read from localStorage:', e);
      }
    }

    return defaultValue || normalizedItems[0].value;
  });

  // Subscribe to group updates
  React.useEffect(() => {
    if (!groupId) return;

    // Create a Set for this group if it doesn't exist
    if (!tabGroups[groupId]) {
      tabGroups[groupId] = new Set();
    }

    // Create a setter function that updates this instance
    const setter = (newValue: string) => {
      setValue(newValue);
    };

    // Add this instance's setter to the group
    tabGroups[groupId].add(setter);

    return () => {
      // Cleanup: remove this instance's setter from the group
      tabGroups[groupId]?.delete(setter);
      if (tabGroups[groupId]?.size === 0) {
        delete tabGroups[groupId];
      }
    };
  }, [groupId]);

  const handleValueChange = (newValue: string) => {
    // Update URL
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set(groupId, newValue);
    router.replace(`?${newParams.toString()}`, { scroll: false });

    // Update state
    setValue(newValue);

    // Update all other tabs in the same group
    if (groupId && tabGroups[groupId]) {
      tabGroups[groupId].forEach(setter => setter(newValue));
    }

    // Persist if enabled
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(getStorageKey(groupId), newValue);
      } catch (e) {
        console.warn('Failed to write to localStorage:', e);
      }
    }
  };

  return (
    <TabsPrimitive.Root 
      className="border rounded-md" 
      value={value} 
      onValueChange={handleValueChange}
      {...props}
    >
      <ScrollArea className="w-full rounded-md rounded-b-none relative bg-secondary dark:bg-secondary/40 border-b">
        <TabsPrimitive.List className="px-4 py-3 flex" role="tablist">
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
              role="tab"
              aria-selected={value === item.value}
            >
              {item.icon && (
                <span className="w-4 h-4 flex items-center justify-center">
                  {item.icon}
                </span>
              )}
              {item.value}
            </TabsPrimitive.Trigger>
          ))}
          <ScrollBar orientation="horizontal" className=""/>
        </TabsPrimitive.List>
      </ScrollArea>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return null;
        return React.cloneElement(child as React.ReactElement<TabProps>);
      })}
    </TabsPrimitive.Root>
  );
}

export function Tab({ value, children }: TabProps) {
  return (
    <TabsPrimitive.Content value={value} className="px-4" role="tabpanel">
      {children}
    </TabsPrimitive.Content>
  );
}