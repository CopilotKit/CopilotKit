"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import posthog from "posthog-js";
import { CloudIcon } from "lucide-react";

export function LinkToCopilotCloud({
  className,
  subPath,
  asButton = true,
  children
}: {
  className?: string;
  subPath?: string;
  asButton?: boolean;
  children?: React.ReactNode;
}) {
  const [isClient, setIsClient] = useState(false);
  const { userId } = useAuth();

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }
  const url = new URL(`https://cloud.copilotkit.ai`);
  url.searchParams.set("ref", "docs");

  const sessionId = posthog.get_session_id();

  if (sessionId) {
    url.searchParams.set("session_id", sessionId);
  }

  if (subPath) {
    url.pathname += subPath;
  }

  let cn = `${className}`;

  if (asButton) {
    cn = "text-indigo-800 ring-1 ring-indigo-200 dark:ring-indigo-900 dark:text-indigo-300 items-center bg-gradient-to-r from-indigo-200/50 to-purple-200/80 dark:from-indigo-900/40 dark:to-purple-900/50 flex p-1.5 px-4 rounded-md ";
    cn += "transition-all duration-100 hover:ring-2 hover:ring-indigo-400";
  } else {
    cn = "_text-primary-600 decoration-from-font underline [text-underline-position:from-font]";
  }

  return (
    <Link
      href={url.toString()}
      target="_blank"
      className={cn}
    >
      {asButton ? <CloudIcon className="w-5 h-5 mr-2" /> : null}
      {
        children ? children : userId ? "Go to Copilot Cloud" : "Sign up for Copilot Cloud"
      }
    </Link>
  );
}