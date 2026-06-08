"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { CloudIcon } from "lucide-react";

export function LinkToCopilotCloud({
  className,
  subPath,
  asButton = true,
  children,
  onClick,
}: {
  className?: string;
  subPath?: string;
  asButton?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Build base URL without PostHog session ID to avoid hydration issues
  const baseUrl = new URL(`https://dashboard.operations.copilotkit.ai/sign-in`);
  baseUrl.searchParams.set("ref", "docs");

  if (subPath) {
    baseUrl.pathname += subPath;
  }

  // Only add PostHog session ID on client side after hydration
  const [href, setHref] = useState(baseUrl.toString());

  useEffect(() => {
    if (isClient) {
      const sessionId = posthog.get_session_id();
      if (sessionId) {
        const url = new URL(baseUrl.toString());
        url.searchParams.set("session_id", sessionId);
        setHref(url.toString());
      }
    }
  }, [isClient, baseUrl.toString()]);

  let cn = "";

  if (asButton) {
    cn =
      "shell-docs-radius-control flex items-center whitespace-nowrap border border-[var(--accent)] bg-[var(--accent-dim)] p-3 px-4 text-sm text-[var(--accent)] no-underline shadow-[var(--shadow-control)]";
    cn +=
      " transition-colors duration-100 hover:bg-[var(--accent)] hover:text-[var(--primary-foreground)]";
  } else {
    cn =
      "_text-primary-600 decoration-from-font underline [text-underline-position:from-font]";
  }

  if (className) {
    cn += ` ${className}`;
  }
  return (
    <Link
      href={href}
      target="_blank"
      className={cn}
      onClick={onClick}
      suppressHydrationWarning
    >
      {asButton ? <CloudIcon className="w-5 h-5 mr-2" /> : null}
      {children ? children : "Free Developer Access"}
    </Link>
  );
}
