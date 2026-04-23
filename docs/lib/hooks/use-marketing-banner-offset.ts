"use client";

import { useLayoutEffect, useState } from "react";

export const DOCS_MARKETING_BANNER_ROOT_ID = "docs-marketing-banner-root";

const MIN_VISIBLE_BANNER_HEIGHT_PX = 24;

export const useMarketingBannerOffset = () => {
  const [offsetPx, setOffsetPx] = useState(0);

  useLayoutEffect(() => {
    const el = document.getElementById(DOCS_MARKETING_BANNER_ROOT_ID);
    if (!el) {
      setOffsetPx(0);
      return;
    }

    const update = () => {
      const h = el.getBoundingClientRect().height;
      setOffsetPx(h < MIN_VISIBLE_BANNER_HEIGHT_PX ? 0 : Math.round(h));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  return offsetPx;
};
