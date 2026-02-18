"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export function ThemeOverride() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const themeParam = searchParams.get("theme");

    if (themeParam === "dark") {
      document.documentElement.classList.add("dark");
      localStorage.theme = "dark";
    } else if (themeParam === "light") {
      document.documentElement.classList.remove("dark");
      localStorage.theme = "light";
    }
  }, [searchParams]);

  return null;
}
