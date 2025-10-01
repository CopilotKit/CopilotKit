'use client';

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Plug, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { integrations } from "@/components/react/integrations";
import Image from "next/image";

export function IntegrationPicker() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = (href: string, title: string) => {
    setSelectedIntegration(title);
    setIsOpen(false);
    router.push(href);
  };

  return (
    <div className="my-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold mb-3">Select Your Integration</h2>
          <p className="text-muted-foreground">
            CopilotKit works with any LLM or agent framework. Choose an integration to see the full feature set.
          </p>
        </div>

        {/* Kite Logo with arrow connecting to picker */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Image
              src="https://cdn.copilotkit.ai/docs/copilotkit/icons/copilotkit-color.svg"
              alt="CopilotKit"
              height={72}
              width={72}
            />
          </div>
          
          {/* Connecting arrow (double-headed) */}
          <div className="flex items-center mx-3">
            {/* Left arrowhead */}
            <div 
              className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[9px]" 
              style={{ borderRightColor: 'var(--primary)', opacity: 0.8 }}
            />
            {/* Arrow line */}
            <div 
              className="h-1 w-15" 
              style={{ backgroundColor: 'var(--primary)', opacity: 0.8 }}
            />
            {/* Right arrowhead */}
            <div 
              className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[9px]" 
              style={{ borderLeftColor: 'var(--primary)', opacity: 0.8 }}
            />
          </div>

          {/* Picker */}
          <div ref={dropdownRef} className="relative w-full max-w-sm">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "w-full px-6 py-4 rounded-xl border-2 transition-all duration-200",
              "flex items-center justify-between gap-4",
              "bg-white dark:bg-zinc-900",
              "hover:border-primary/60 hover:shadow-md",
              isOpen 
                ? "border-primary shadow-md" 
                : "border-border"
            )}
          >
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                "bg-primary/10 text-primary"
              )}>
                <Plug className="w-5 h-5" />
              </div>
              <span className="text-base font-medium text-muted-foreground">
                Select an integration...
              </span>
            </div>
            <ChevronDown 
              className={cn(
                "w-5 h-5 text-muted-foreground transition-transform duration-200",
                isOpen && "transform rotate-180"
              )} 
            />
          </button>

          {/* Dropdown */}
          {isOpen && (
            <div className={cn(
              "absolute top-full left-0 right-0 mt-2 z-50",
              "bg-white dark:bg-zinc-900 rounded-xl border-2 border-border",
              "shadow-xl max-h-[600px] overflow-y-auto"
            )}>
              <div className="p-2">
                {integrations.map((integration, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelect(integration.href, integration.title)}
                    className={cn(
                      "w-full px-4 py-3 rounded-lg",
                      "flex items-center gap-4",
                      "hover:bg-accent transition-colors duration-150",
                      "text-left"
                    )}
                  >
                    <div 
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                        integration.bgGradient
                      )}
                    >
                      {integration.logo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground">
                        {integration.title}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

