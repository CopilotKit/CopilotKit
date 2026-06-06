"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import styles from "./threads-drawer.module.css";

export function ThreadsPanelGate({ children }: { children: React.ReactNode }) {
  // The Threads drawer reads a client-only external store (useThreads /
  // useSyncExternalStore) with no server snapshot, so it must not render during
  // SSR/prerender — Next would fail to prerender "/". Defer to client mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (process.env.NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED === "true") {
    if (!mounted) {
      // SSR / first-paint placeholder: matches the open drawer's footprint +
      // surface (and collapses to nothing on mobile) so the panel doesn't flash
      // a bare-background column or shift the content when the drawer mounts.
      return <div className={styles.drawerPlaceholder} aria-hidden />;
    }
    return <>{children}</>;
  }

  return (
    <div className="flex w-80 shrink-0 flex-col items-center justify-center p-4 bg-[var(--threads-drawer-bg,var(--card))] border-r border-[var(--threads-drawer-border,var(--border))] max-lg:hidden">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--secondary)]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--muted-foreground)]"
              aria-hidden="true"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <CardTitle>Threads</CardTitle>
          <CardDescription>
            Threads is a licensed CopilotKit Intelligence feature. Unlock
            persistent conversation history, multi-session context, and thread
            management across your application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted-foreground)]">
            To enable Threads, add a CopilotKit Intelligence license to your
            project with:
          </p>
        </CardContent>
        <CardFooter className="flex-col items-start gap-3">
          <div className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--secondary)] px-3 py-2">
            <code className="text-xs whitespace-nowrap text-[var(--secondary-foreground)]">
              copilotkit license
            </code>
          </div>
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={() =>
              window.open(
                "https://docs.copilotkit.ai/intelligence",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            Learn more
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
