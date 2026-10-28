"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import ReactGA from "react-ga4";
import {
  initPostHog,
  normalizePathnameForAnalytics,
  trackCommandCopy,
  trackEvent,
  trackPageview,
} from "@/lib/telemetry/analytics";
import type { TelemetryConfig } from "@/lib/telemetry/config";

declare global {
  interface Window {
    __SHOWCASE_CONFIG__?: TelemetryConfig;
  }
}

// One request per page load, shared by every mount (Strict Mode remounts).
let configRequest: Promise<TelemetryConfig> | undefined;

function loadConfig(): Promise<TelemetryConfig> {
  // Set already if a page inlined it the way shell-docs' layout did.
  if (window.__SHOWCASE_CONFIG__) {
    return Promise.resolve(window.__SHOWCASE_CONFIG__);
  }
  configRequest ??= fetch("/api/telemetry/config")
    .then((res) => (res.ok ? (res.json() as Promise<TelemetryConfig>) : null))
    .catch(() => null)
    .then((config) => {
      // A failed request turns every channel off (and drops queued events).
      window.__SHOWCASE_CONFIG__ = config ?? {
        posthogKey: "",
        scarfPixelId: "",
        googleAnalyticsTrackingId: "",
        reb2bKey: "",
        reoKey: "",
      };
      return window.__SHOWCASE_CONFIG__;
    });
  return configRequest;
}

/**
 * Every analytics channel shell-docs ran, mounted once from the root layout:
 * PostHog (pageviews per client navigation), Google Analytics, the global
 * copy tracker, HubSpot, Reo, reb2b, and the Scarf pixel. Renders nothing
 * visible. Keys come from the live env via `/api/telemetry/config`; an empty
 * key turns its channel off.
 */
export function Telemetry() {
  const pathname = usePathname();
  const [config, setConfig] = useState<TelemetryConfig | null>(null);

  useEffect(() => {
    let live = true;
    loadConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);

  // PostHog: init once the key is known, then a $pageview per path.
  useEffect(() => {
    if (config) initPostHog(config.posthogKey);
  }, [config]);
  const lastPageview = useRef<string | null>(null);
  useEffect(() => {
    if (!config?.posthogKey || lastPageview.current === pathname) return;
    lastPageview.current = pathname;
    trackPageview(pathname);
  }, [config, pathname]);

  // Google Analytics (GA4), as shell-docs' useGoogleAnalytics.
  const gaId = config?.googleAnalyticsTrackingId;
  useEffect(() => {
    if (gaId) ReactGA.initialize([{ trackingId: gaId }]);
  }, [gaId]);
  useEffect(() => {
    if (!gaId) return;
    ReactGA.send({
      hitType: "pageview",
      page: normalizePathnameForAnalytics(pathname),
    });
  }, [gaId, pathname]);

  useCopyTracker();

  return (
    <>
      <Script
        id="hubspot-script"
        type="text/javascript"
        src="https://js.hs-scripts.com/45532593.js"
        async
        defer
      />
      {config?.reoKey ? (
        <Script
          id="reo-init-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `!function(){var e=${JSON.stringify(config.reoKey)},t=function(){window.Reo&&window.Reo.init({clientID:e,enableThirdPartyTracking:true})},n=document.createElement("script");n.src="https://static.reo.dev/"+e+"/reo.js";n.defer=true;n.onload=t;document.head.appendChild(n)}();`,
          }}
        />
      ) : null}
      {config?.reb2bKey ? (
        <Script
          id="reb2b-script"
          strategy="afterInteractive"
          src={`https://b2bjsstore.s3.us-west-2.amazonaws.com/b/${config.reb2bKey}/${config.reb2bKey}.js.gz`}
        />
      ) : null}
      {config?.scarfPixelId ? (
        // eslint-disable-next-line @next/next/no-img-element -- a tracking pixel
        <img
          referrerPolicy="no-referrer-when-downgrade"
          src={`https://static.scarf.sh/a.png?x-pxid=${config.scarfPixelId}`}
          alt=""
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            opacity: 0,
            pointerEvents: "none",
            left: "-9999px",
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Reports every clipboard write on the site, whoever makes it (Fumadocs'
 * CodeBlock copy button, the page actions, Copy prompt): `cli_command_copied`,
 * plus `docs_conversion_copied` when the focused control sits inside a
 * `[data-docs-copy-surface]` element. Wraps `navigator.clipboard.writeText`,
 * as shell-docs' CopyTracker did, so no copy button needs forking.
 */
function useCopyTracker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    const clipboard = navigator.clipboard;
    const original = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async (text: string) => {
      // Read attribution before the write can move focus or navigate.
      const location = window.location.pathname;
      let surface: string | undefined;
      try {
        const active = document.activeElement;
        surface =
          active instanceof Element
            ? active.closest<HTMLElement>("[data-docs-copy-surface]")?.dataset
                .docsCopySurface
            : undefined;
      } catch {
        // Attribution must not prevent copying.
      }
      await original(text);
      trackCommandCopy({ command: text, location });
      if (surface) trackEvent("docs_conversion_copied", { surface });
    };
    return () => {
      clipboard.writeText = original;
    };
  }, []);
}
