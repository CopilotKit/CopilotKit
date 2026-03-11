"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import ReactGA from "react-ga4";
import { normalizePathnameForAnalytics } from "@/lib/analytics-utils";

export function useGoogleAnalytics() {
  const GA_ID = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID;

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
