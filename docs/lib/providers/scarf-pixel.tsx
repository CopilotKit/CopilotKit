"use client"

import React from 'react';

export function ScarfPixel() {
  const SCARF_PIXEL_ID = process.env.NEXT_PUBLIC_SCARF_PIXEL_ID;
  if (!SCARF_PIXEL_ID) return null;
  return <img referrerPolicy="no-referrer-when-downgrade" src={`https://static.scarf.sh/a.png?x-pxid=${SCARF_PIXEL_ID}`} />;
}