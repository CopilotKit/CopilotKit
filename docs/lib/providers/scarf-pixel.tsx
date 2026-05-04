"use client";

import React from "react";
import { useConsent } from "@/lib/consent/ConsentContext";

export function ScarfPixel() {
  const { state, hydrated } = useConsent();
  const SCARF_PIXEL_ID = process.env.NEXT_PUBLIC_SCARF_PIXEL_ID;
  if (!SCARF_PIXEL_ID) return null;
  if (!hydrated || !state.categories.marketing) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      referrerPolicy="no-referrer-when-downgrade"
      src={`https://static.scarf.sh/a.png?x-pxid=${SCARF_PIXEL_ID}`}
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
  );
}
