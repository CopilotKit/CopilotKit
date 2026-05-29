"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

export function useGoogleAnalytics() {
  // Tracking ID is read at render time from the runtime config injected
  // by the root layout. Empty string disables GA — the early return
  // below already gates on truthiness.
  const GA_ID = getRuntimeConfig().googleAnalyticsTrackingId;

  if (!GA_ID) {
    return;
  }

  const pathname = usePathname();

  useEffect(() => {
    ReactGA.initialize([{ trackingId: GA_ID }]);
  }, []);

  useEffect(() => {
    const normalizedPathname = normalizePathnameForAnalytics(pathname);
    ReactGA.send({ hitType: "pageview", page: normalizedPathname });
  }, [pathname]);
}
