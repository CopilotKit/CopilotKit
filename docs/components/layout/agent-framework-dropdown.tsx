"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useRouter, usePathname } from "next/navigation";
import { useRef } from "react";
import { Bot, UserCog } from "lucide-react";
import { SiLangchain } from "react-icons/si";
import { SiCrewai } from "@icons-pack/react-simple-icons";
import { AG2Icon, MastraIcon } from "@/lib/icons/custom-icons";

export interface FrameworkOption {
  title: string;
  url: string;
  icon: React.ReactNode;
  bgGradient?: string;
}

export interface FrameworkCategory {
  name: string;
  options: FrameworkOption[];
}

export function AgentFrameworkDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const selectRef = useRef(null);

  const categories: FrameworkCategory[] = [
    {
      name: "High Level",
      options: [
        {
          title: "The Standard Agent",
          url: "/",
          icon: <Bot className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-blue-700 to-blue-400"
        }
      ]
    },
    {
      name: "Low Level",
      options: [
        {
          title: "Introduction to ag-ui",
          url: "/coagents-home",
          icon: <UserCog className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-purple-700 to-purple-400"
        },
        {
          title: "LangGraph",
          url: "/langgraph",
          icon: <SiLangchain className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-green-700 to-green-400"
        },
        {
          title: "CrewAI Flows",
          url: "/crewai-flows",
          icon: <SiCrewai className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-orange-700 to-orange-400"
        },
        {
          title: "CrewAI Crews",
          url: "/crewai-crews",
          icon: <SiCrewai className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-yellow-700 to-yellow-400"
        },
        {
          title: "Mastra",
          url: "/mastra",
          icon: <MastraIcon className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-red-700 to-red-400"
        },
        {
          title: "AG2",
          url: "/ag2",
          icon: <AG2Icon className="w-4 h-4 text-white" />,
          bgGradient: "bg-gradient-to-b from-indigo-700 to-indigo-400"
        }
      ]
    }
  ];

  // Current path is determined by usePathname() hook
  
  // Find the selected option across all categories
  let selectedOption: FrameworkOption | undefined;
  for (const category of categories) {
    const found = category.options.find(option => 
      option.url === pathname || 
      (option.url !== '/' && pathname.startsWith(option.url))
    );
    if (found) {
      selectedOption = found;
      break;
    }
  }

  // Default to first option if nothing is selected
  if (!selectedOption && categories.length > 0 && categories[0].options.length > 0) {
    selectedOption = categories[0].options[0];
  }

  return (
    <div className="relative">
      <Select
        onValueChange={(url) => {
          router.push(url);
          if (selectRef.current) {
            setTimeout(() => {
              (selectRef.current as any).blur();
            }, 10);
          }
        }}
        value={selectedOption?.url}
      >
        <SelectTrigger
          className="border bg-background h-9 px-3 py-2 w-[250px] flex items-center gap-2"
          ref={selectRef}
        >
          <SelectValue
            placeholder={
              <div className="flex items-center w-full gap-2">
                {selectedOption?.icon && (
                  <div className={cn("rounded-sm p-1", selectedOption.bgGradient)}>
                    {selectedOption.icon}
                  </div>
                )}
                <span className="font-medium text-sm">{selectedOption?.title || "Select Framework"}</span>
              </div>
            }
          />
        </SelectTrigger>
        <SelectContent className="p-1">
          {categories.map((category, categoryIndex) => (
            <div key={category.name || `category-${categoryIndex}`}>
              {/* Category header */}
              {category.name && (
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {category.name}
                </div>
              )}
              
              {/* Category options */}
              {category.options.map((option) => (
                <SelectItem
                  key={option.url}
                  value={option.url}
                  className="py-2 px-2 cursor-pointer focus:bg-accent focus:text-accent-foreground"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("rounded-sm p-1", option.bgGradient)}>
                      {option.icon}
                    </div>
                    <span className="font-medium text-sm">{option.title}</span>
                  </div>
                </SelectItem>
              ))}
              
              {/* Add divider between categories */}
              {categoryIndex < categories.length - 1 && (
                <div className="my-1 border-t border-border" />
              )}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
