import React from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Item {
  number: string;
  short_description: string;
  state: number;
  sys_created_on: string;
}

interface ServiceNowListProps {
  items: Item[];
  title: string;
}

export function ServiceNowList({ items, title }: ServiceNowListProps) {
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(
    new Set(),
  );

  const toggleItem = (number: string) => {
    const newExpandedItems = new Set(expandedItems);
    if (newExpandedItems.has(number)) {
      newExpandedItems.delete(number);
    } else {
      newExpandedItems.add(number);
    }
    setExpandedItems(newExpandedItems);
  };

  return (
    <div className="w-full max-w-md bg-white rounded-lg shadow-sm border">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <ScrollArea>
        {items.map((item) => (
          <div key={item.number} className="border-b last:border-b-0">
            <Button
              variant="ghost"
              className="w-full justify-between p-4 hover:bg-gray-50"
              onClick={() => toggleItem(item.number)}
            >
              <div className="flex items-center">
                <span className="font-medium">{item.number}</span>
              </div>
              {expandedItems.has(item.number) ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            {expandedItems.has(item.number) && (
              <div className="px-4 py-2 bg-gray-50">
                <p className="text-sm text-gray-600">
                  {item.short_description}
                </p>
                <div className="flex justify-between content-center">
                  <p className="text-xs text-gray-400 mt-1">
                    Created: {item.sys_created_on}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    State: {item.state}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}
