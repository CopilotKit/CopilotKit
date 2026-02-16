"use client";
import React from "react";
import Link from "next/link";

export function CoAgentsEnterpriseCTA() {
  return (
    <div className="selected relative mt-4 mb-4 space-y-2 overflow-hidden rounded-lg bg-gradient-to-r from-indigo-100/80 to-purple-100 p-5 shadow-lg ring-1 ring-indigo-200 dark:from-indigo-950/50 dark:to-purple-950/50 dark:ring-indigo-500/30">
      <p className="mt-0 text-lg font-medium dark:text-white">
        Learn to build Agent-Native Applications / with LangGraph and CoAgents.
      </p>
      <p>
        <Link
          href="https://www.youtube.com/watch?v=0b6BVqPwqA0"
          target="_blank"
          className="mt-3 block no-underline"
        >
          <button className="mt-2 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600">
            <span>Watch the demo</span>
          </button>
        </Link>
      </p>
      <p className="absolute right-[10px] bottom-[-40px] z-0 text-[150px] opacity-15">
        🪁
      </p>
    </div>
  );
}
