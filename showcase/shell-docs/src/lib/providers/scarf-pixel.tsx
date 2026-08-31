"use client";

import React from "react";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

export function ScarfPixel() {
  // Pixel ID from the runtime config injected by the root layout —
  // empty string disables the pixel (consumer no-ops on falsy).
  const SCARF_PIXEL_ID = getRuntimeConfig().scarfPixelId;
  if (!SCARF_PIXEL_ID) return null;
  return (
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
