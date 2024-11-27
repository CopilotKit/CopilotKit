import React from "react";
import Link from "next/link";

export function CoAgentsEnterpriseCTA() {
  return (
    <div className="mt-4 mb-4 ring-1 ring-indigo-200 selected bg-gradient-to-r from-indigo-100/80 to-purple-100 shadow-lg rounded-lg p-5 space-y-2 relative overflow-hidden">
      <p className="text-lg mt-0 font-medium">
        Learn to build Agent-Native Applications / with LangGraph and Agentic Copilots.
      </p>
      {/* <p className="text-sm text-neutral-600 z-1">
        We're excited to invite you to our Agent-Native Applications webinar on
        October 28th. We'll learn how to build Agent-Native Applications in a
        single sitting, using LangGraph and Agentic Copilots.
      </p> */}
      <p>
        <Link
          href="https://www.youtube.com/watch?v=0b6BVqPwqA0"
          target="_blank"
          className="block mt-3 no-underline">
          <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 mt-2 font-medium">
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
