"use client";

import { usePathname } from "next/navigation";

export function CoagentsV0_3Banner() {
  const pathname = usePathname();
  const isCoagentsPath = pathname.startsWith("/coagents");
  console.log(pathname);

  if (isCoagentsPath) {
    return (
      <div className="bg-gradient-to-r from-indigo-900 via-blue-800 to-indigo-900 text-primary-foreground px-4 py-3 text-center relative">
        <p className="font-medium">
          <span className="mr-2 font-bold">CoAgents v0.3</span>
          Big quality of life improvements coming soon!
          <a
            href="https://docs-git-coagents-v03-copilot-kit.vercel.app/coagents?_vercel_share=ytbAsEuomfS4oWtqM9ZCkptn7gVuO6az"
            className="ml-2 underline font-semibold hover:text-primary-foreground/80"
          >
            Check out the pre-release here
          </a>
        </p>
        <p className="text-sm mt-1">Available right after the holidays</p>
      </div>
    );
  } else {
    return null;
  }
}
