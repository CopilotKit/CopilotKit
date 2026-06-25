"use client";

import type { ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";

interface ExampleLayoutProps {
  chatContent: ReactNode;
  chatOverlay?: ReactNode;
}

export function ExampleLayout({
  chatContent,
  chatOverlay,
}: ExampleLayoutProps) {
  return (
    <div className="h-full pb-6">
      <div className="relative mx-auto flex h-full max-h-full max-w-5xl flex-col px-4 dark:bg-stone-950">
        <div className="shrink-0 pt-6 pl-6 pb-2 max-lg:pl-4 max-lg:pt-4 flex gap-1.5 items-center align-center">
          <span className="font-extrabold text-2xl pb-1.5">
            OpenBox x CopilotKit
          </span>
          <img
            src={withBasePath("/copilotkit-logo-mark.svg")}
            alt="CopilotKit"
            className="h-7"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{chatContent}</div>
        {chatOverlay}
      </div>
    </div>
  );
}
