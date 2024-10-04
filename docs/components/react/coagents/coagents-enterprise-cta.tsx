import React from "react";
import Link from "next/link";

export function CoAgentsEnterpriseCTA() {
  return (
    <div className="mt-4 mb-4 ring-1 ring-indigo-200 selected bg-gradient-to-r from-indigo-100/80 to-purple-100 shadow-lg rounded-lg p-5 space-y-2 relative overflow-hidden">
      <p className="text-lg mt-0 font-medium">
        Want to Run CoAgents in Production?
      </p>
      <p className="text-sm text-neutral-600 z-1">
        We offer tailored solutions for Enterprise customers. We'd be happy to
        support you with custom use cases, deploying and scaling CoAgents in
        production.
      </p>
      <p>
        <Link
          href="https://calendly.com/atai_/copilotkit"
          target="_blank"
          className="block mt-3 no-underline"
        >
          <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 mt-2 font-medium">
            <span>Let's Talk</span>
          </button>
        </Link>
      </p>
      <p className="absolute bottom-[-40px] right-[10px] text-[150px] z-0 opacity-15">
        🪁
      </p>
    </div>
  );
}
