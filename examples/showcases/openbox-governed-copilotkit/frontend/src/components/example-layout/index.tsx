"use client";

import type { ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";

interface ExampleLayoutProps {
  chatContent: ReactNode;
  chatOverlay?: ReactNode;
  sidePanel?: ReactNode;
}

export function ExampleLayout({
  chatContent,
  chatOverlay,
  sidePanel,
}: ExampleLayoutProps) {
  const hasSidePanel = Boolean(sidePanel);
  return (
    <div className="h-full pb-6">
      <div
        className={`relative mx-auto flex h-full max-h-full flex-col px-4 dark:bg-stone-950 ${
          hasSidePanel ? "max-w-7xl" : "max-w-5xl"
        }`}
      >
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
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">{chatContent}</div>
            {chatOverlay}
          </div>
          {hasSidePanel ? (
            <div className="hidden min-h-0 w-[22rem] shrink-0 lg:flex xl:w-[26rem]">
              {sidePanel}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
