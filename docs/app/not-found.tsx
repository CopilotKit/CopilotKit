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
    <div className="fixed inset-0 flex flex-col items-center justify-center p-4 bg-background z-50">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex justify-center mb-8">
          <div className="scale-150">
            <Logo />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-6xl font-bold text-foreground">404</h1>
          <h2 className="text-2xl font-semibold text-foreground">
            Page Not Found
          </h2>
          <p className="text-muted-foreground">
            Sorry, we couldn't find the page you're looking for. The link may be
            outdated or the page may have moved.
          </p>
        </div>

        <div className="flex gap-4 justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            <Home className="w-4 h-4" />
            Go Home
          </Link>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-accent transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
