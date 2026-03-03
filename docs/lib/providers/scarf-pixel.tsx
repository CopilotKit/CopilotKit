"use client";

import React from "react";

export function ScarfPixel() {
  const SCARF_PIXEL_ID = process.env.NEXT_PUBLIC_SCARF_PIXEL_ID;
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
