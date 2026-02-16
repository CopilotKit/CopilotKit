"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { Home, ArrowLeft } from "lucide-react";
import { Logo } from "./logo";

function isBotUserAgent(userAgent: string): boolean {
  const botPatterns = [
    /bot/i,
    /crawl/i,
    /spider/i,
    /slurp/i,
    /mediapartners/i,
    /googlebot/i,
    /bingbot/i,
    /facebookexternalhit/i,
    /twitterbot/i,
  ];
  return botPatterns.some((pattern) => pattern.test(userAgent));
}

export default function NotFound() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const referrer = document.referrer;
    const userAgent = navigator.userAgent;
    const isBot = isBotUserAgent(userAgent);

    // Only track if PostHog is initialized and it's not a bot
    if (posthog?.__loaded && !isBot) {
      const queryString = searchParams?.toString();
      const fullPath = pathname + (queryString ? `?${queryString}` : "");

      // Check if referrer is internal (docs site or corporate site)
      const isInternalReferrer =
        referrer.includes("copilotkit.ai") || referrer.includes("localhost");

      // Parse referrer URL if available
      let referrerDomain = null;
      let referrerPath = null;
      if (referrer) {
        try {
          const referrerUrl = new URL(referrer);
          referrerDomain = referrerUrl.hostname;
          referrerPath = referrerUrl.pathname;
        } catch (e) {
          // Invalid URL, skip parsing
        }
      }

      try {
        posthog.capture("broken_link_accessed", {
          // The broken URL
          broken_url: pathname,
          broken_url_full: `https://docs.copilotkit.ai${fullPath}`,
          query_params: queryString || null,

          // Where they came from
          referrer_url: referrer || "(direct)",
          referrer_domain: referrerDomain,
          referrer_path: referrerPath,
          is_internal_referrer: isInternalReferrer,

          // Context for filtering
          user_agent: userAgent,
          is_likely_bot: isBot,

          // Useful metadata
          timestamp: new Date().toISOString(),
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight,
        });
      } catch (error) {
        // Silently fail if tracking fails
        if (process.env.NODE_ENV === "development") {
          console.warn("Failed to track 404:", error);
        }
      }
    }
  }, [pathname, searchParams]);

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="mb-8 flex justify-center">
          <div className="scale-150">
            <Logo />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-foreground text-6xl font-bold">404</h1>
          <h2 className="text-foreground text-2xl font-semibold">
            Page Not Found
          </h2>
          <p className="text-muted-foreground">
            Sorry, we couldn't find the page you're looking for. The link may be
            outdated or the page may have moved.
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <Link
            href="/"
            className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-md px-4 py-2 font-medium transition-opacity hover:opacity-90"
          >
            <Home className="h-4 w-4" />
            Go Home
          </Link>
          <button
            onClick={() => window.history.back()}
            className="bg-secondary text-secondary-foreground hover:bg-accent inline-flex items-center gap-2 rounded-md px-4 py-2 font-medium transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
