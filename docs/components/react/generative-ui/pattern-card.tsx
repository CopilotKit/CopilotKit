"use client";

import Image from "next/image";
import { Check, AlertCircle } from "lucide-react";
import { ReactNode } from "react";

interface PatternExample {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

interface PatternCardProps {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  description: string;
  fullDescription: string | ReactNode;
  whyUse: string[];
  tradeoffs: string[];
  exampleTitle?: string;
  examples?: PatternExample[];
}

export function PatternCard({
  id,
  index,
  title,
  subtitle,
  description,
  fullDescription,
  whyUse,
  tradeoffs,
  exampleTitle,
  examples = [],
}: PatternCardProps) {
  return (
    <div id={id} className="flex flex-col items-center gap-6 w-full my-8">
      {/* Two Column Layout: Description left, Why Use It & Tradeoffs stacked on right */}
      <div className="w-full flex flex-col md:flex-row gap-6">
        {/* Left column: Description (1/2 width) */}
        <div className="w-full md:w-1/2 rounded-lg border border-border bg-card p-6 md:p-8 flex flex-col">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">
            {index}. {title} Generative UI
          </h2>
          <p className="text-sm md:text-base text-muted-foreground italic mb-4">
            {subtitle}
          </p>
          <p className="text-sm md:text-base mb-4">{description}</p>
          <div className="text-sm md:text-base text-muted-foreground">
            {fullDescription}
          </div>
        </div>

        {/* Right column: Why Use It & Tradeoffs stacked (1/2 width) */}
        <div className="w-full md:w-1/2 flex flex-col gap-6">
          {/* Why Use It */}
          <div className="rounded-lg border border-border bg-card p-6 md:p-8">
            <h3 className="text-lg md:text-xl font-semibold mb-4">
              Why teams use it:
            </h3>
            <ul className="flex flex-col gap-3 text-sm md:text-base">
              {whyUse.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tradeoffs */}
          <div className="rounded-lg border border-border bg-card p-6 md:p-8">
            <h3 className="text-lg md:text-xl font-semibold mb-4">
              Tradeoffs:
            </h3>
            <ul className="flex flex-col gap-3 text-sm md:text-base">
              {tradeoffs.map((tradeoff, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
                  <span>{tradeoff}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Example Diagrams */}
      {examples.length > 0 && (
        <div className="w-full rounded-lg border border-border bg-card p-6 md:p-8">
          {exampleTitle && (
            <h3 className="text-lg md:text-xl font-semibold mb-6 text-center">
              {exampleTitle}
            </h3>
          )}
          <div className="flex flex-col gap-6">
            {examples.map((example, i) => (
              <div key={i} className="flex flex-col items-center gap-4">
                <div className="relative w-full rounded-lg overflow-hidden">
                  <Image
                    src={example.src}
                    alt={example.alt}
                    width={example.width || 1400}
                    height={example.height || 600}
                    className="w-full h-auto"
                  />
                </div>
                {example.caption && (
                  <p className="text-sm md:text-base text-muted-foreground text-center">
                    {example.caption}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
