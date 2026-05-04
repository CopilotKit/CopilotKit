"use client";

import { CookieBanner } from "./CookieBanner";
import { CookiePreferencesButton } from "./CookiePreferencesButton";
import { CookiePreferencesModal } from "./CookiePreferencesModal";
import { TrackingScripts } from "./TrackingScripts";

export function ConsentLayer() {
  return (
    <>
      <TrackingScripts />
      <CookieBanner />
      <CookiePreferencesButton />
      <CookiePreferencesModal />
    </>
  );
}
