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
    <div id={id} className="my-8 flex w-full flex-col items-center gap-6">
      {/* Two Column Layout: Description left, Why Use It & Tradeoffs stacked on right */}
      <div className="flex w-full flex-col gap-6 md:flex-row">
        {/* Left column: Description (1/2 width) */}
        <div className="border-border bg-card flex w-full flex-col rounded-lg border p-6 md:w-1/2 md:p-8">
          <h2 className="mb-2 text-2xl font-semibold md:text-3xl">
            {index}. {title} Generative UI
          </h2>
          <p className="text-muted-foreground mb-4 text-sm italic md:text-base">
            {subtitle}
          </p>
          <p className="mb-4 text-sm md:text-base">{description}</p>
          <div className="text-muted-foreground text-sm md:text-base">
            {fullDescription}
          </div>
        </div>

        {/* Right column: Why Use It & Tradeoffs stacked (1/2 width) */}
        <div className="flex w-full flex-col gap-6 md:w-1/2">
          {/* Why Use It */}
          <div className="border-border bg-card rounded-lg border p-6 md:p-8">
            <h3 className="mb-4 text-lg font-semibold md:text-xl">
              Why teams use it:
            </h3>
            <ul className="flex flex-col gap-3 text-sm md:text-base">
              {whyUse.map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tradeoffs */}
          <div className="border-border bg-card rounded-lg border p-6 md:p-8">
            <h3 className="mb-4 text-lg font-semibold md:text-xl">
              Tradeoffs:
            </h3>
            <ul className="flex flex-col gap-3 text-sm md:text-base">
              {tradeoffs.map((tradeoff, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
                  <span>{tradeoff}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Example Diagrams */}
      {examples.length > 0 && (
        <div className="border-border bg-card w-full rounded-lg border p-6 md:p-8">
          {exampleTitle && (
            <h3 className="mb-6 text-center text-lg font-semibold md:text-xl">
              {exampleTitle}
            </h3>
          )}
          <div className="flex flex-col gap-6">
            {examples.map((example, i) => (
              <div key={i} className="flex flex-col items-center gap-4">
                <div className="relative w-full overflow-hidden rounded-lg">
                  <Image
                    src={example.src}
                    alt={example.alt}
                    width={example.width || 1400}
                    height={example.height || 600}
                    className="h-auto w-full"
                  />
                </div>
                {example.caption && (
                  <p className="text-muted-foreground text-center text-sm md:text-base">
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
