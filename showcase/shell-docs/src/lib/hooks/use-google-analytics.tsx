"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

export function useGoogleAnalytics() {
  // Tracking ID is read at render time from the runtime config injected
  // by the root layout. Empty string disables GA — but the gating MUST
  // live INSIDE the effect bodies, not as an early return, otherwise
  // React's rules-of-hooks are violated (hooks below the conditional
  // return would be skipped on renders where GA is disabled, which
  // changes hook order between renders and crashes React).
  const GA_ID = getRuntimeConfig().googleAnalyticsTrackingId;
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_ID) return;
    ReactGA.initialize([{ trackingId: GA_ID }]);
  }, [GA_ID]);

  useEffect(() => {
    if (!GA_ID) return;
    const normalizedPathname = normalizePathnameForAnalytics(pathname);
    ReactGA.send({ hitType: "pageview", page: normalizedPathname });
  }, [pathname, GA_ID]);
}
