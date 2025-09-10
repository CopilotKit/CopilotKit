'use client';
import React from "react";
import Link from "next/link";

export function CoAgentsEnterpriseCTA() {
  return (
    <div className="mt-4 mb-4 ring-1 ring-indigo-200 dark:ring-indigo-500/30 selected bg-gradient-to-r from-indigo-100/80 to-purple-100 dark:from-indigo-950/50 dark:to-purple-950/50 shadow-lg rounded-lg p-5 space-y-2 relative overflow-hidden">
      <p className="text-lg mt-0 font-medium dark:text-white">
        Learn to build Agent-Native Applications / with LangGraph and CoAgents.
      </p>
      <p>
        <Link
          href="https://www.youtube.com/watch?v=0b6BVqPwqA0"
          target="_blank"
          className="block mt-3 no-underline">
          <button className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 mt-2 font-medium">
            <span>Watch the demo</span>
          </button>
        </Link>
      </p>
      <p className="absolute bottom-[-40px] right-[10px] text-[150px] z-0 opacity-15">
        🪁
      </p>
    </div>
  );
}
