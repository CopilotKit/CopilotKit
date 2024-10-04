import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import posthog from "posthog-js";

export function LinkToCopilotCloud({
  className,
  subPath,
  asLink = true,
  children
}: {
  className?: string;
  subPath?: string;
  asLink?: boolean;
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

  if (asLink) {
    cn = "_text-primary-600 decoration-from-font underline [text-underline-position:from-font]";
  }

  return (
    <Link
      href={url.toString()}
      target="_blank"
      className={`${cn}`}
    >
      {
        children ? children : userId ? "Go to Copilot Cloud" : "Sign up to Copilot Cloud"
      }
    </Link>
  );
}
