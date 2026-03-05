"use client";

import React, { Children, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check, ChevronRight } from "lucide-react";

interface CodeShowcaseTab {
  label: string;
  icon: ReactNode;
  filename: string;
}

interface CodeShowcaseProps {
  tabs: CodeShowcaseTab[];
  children: ReactNode;
}

/* Hide the entire fumadocs toolbar (icons + figcaption) and strip default spacing/rounding */
const codeOverrides =
  "[&_figure]:!m-0 [&_figure]:!border-0 [&_figure]:!rounded-none [&_figure>div:first-child]:!hidden [&_pre]:!rounded-none [&_pre]:!border-0";

export function CodeShowcase({ tabs, children }: CodeShowcaseProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const panels = Children.toArray(children);

  const handleCopy = () => {
    const codeEl = document.querySelector(
      `[data-code-panel="${activeIndex}"] pre code`,
    );
    if (codeEl) {
      navigator.clipboard.writeText(codeEl.textContent || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="not-prose mb-16">
      {/* Desktop */}
      <div className="hidden md:block rounded-2xl">
        <div className="rounded-xl overflow-hidden border border-border/80 shadow-sm bg-card">
          {/* Title bar */}
          <div className="flex items-center px-4 py-2.5 bg-card border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
            </div>
            <div className="flex-1 text-center text-xs text-muted-foreground font-medium">
              {tabs[activeIndex]?.filename}
            </div>
            <button
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
              aria-label="Copy code"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {/* Content */}
          <div className="flex">
            {/* Sidebar */}
            <div className="w-48 shrink-0 bg-card border-r border-border/60 py-3">
              {tabs.map((tab, i) => (
                <button
                  key={tab.label}
                  onClick={() => setActiveIndex(i)}
                  className={cn(
                    "flex items-center justify-between w-full px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                    i === activeIndex
                      ? "text-primary bg-accent/50"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex-shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                      {tab.icon}
                    </span>
                    {tab.label}
                  </div>
                  {i === activeIndex && (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              ))}
            </div>
            {/* Code panel */}
            <div className={cn("flex-1 min-w-0", codeOverrides)}>
              {panels.map((panel, i) => (
                <div
                  key={i}
                  data-code-panel={i}
                  className={i === activeIndex ? "block" : "hidden"}
                >
                  {panel}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden rounded-2xl bg-muted/50 p-2">
        <div className="rounded-xl overflow-hidden border border-border/80 shadow-sm bg-card">
          {/* Title bar */}
          <div className="flex items-center px-3 py-2 bg-card border-b border-border/60">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#FF5F57]" />
              <div className="w-2 h-2 rounded-full bg-[#FEBC2E]" />
              <div className="w-2 h-2 rounded-full bg-[#28C840]" />
            </div>
            <div className="flex-1 text-center text-xs text-muted-foreground font-medium">
              {tabs[activeIndex]?.filename}
            </div>
            <button
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
              aria-label="Copy code"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {/* Tab bar */}
          <div className="flex overflow-x-auto bg-card border-b border-border/60 px-1 py-1">
            {tabs.map((tab, i) => (
              <button
                key={tab.label}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors rounded-md cursor-pointer",
                  i === activeIndex
                    ? "text-primary bg-accent/50"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex-shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))}
          </div>
          {/* Code */}
          <div className={codeOverrides}>
            {panels.map((panel, i) => (
              <div
                key={i}
                data-code-panel={i}
                className={i === activeIndex ? "block" : "hidden"}
              >
                {panel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CodePanel({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
