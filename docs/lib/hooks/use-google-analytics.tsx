"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";
import { useConsent } from "@/lib/consent/ConsentContext";

export function useGoogleAnalytics() {
  const GA_ID = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID;
  const pathname = usePathname();
  const { state, hydrated } = useConsent();
  const allowed = hydrated && state.categories.analytics;

  useEffect(() => {
    if (!GA_ID || !allowed) return;
    ReactGA.initialize([{ trackingId: GA_ID }]);
  }, [GA_ID, allowed]);

  useEffect(() => {
    if (!GA_ID || !allowed) return;
    const normalizedPathname = normalizePathnameForAnalytics(pathname);
    ReactGA.send({ hitType: "pageview", page: normalizedPathname });
  }, [GA_ID, allowed, pathname]);
}
