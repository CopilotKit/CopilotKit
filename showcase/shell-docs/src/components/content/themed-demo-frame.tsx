"use client";

import type { CSSProperties, IframeHTMLAttributes } from "react";
import { useMemo } from "react";
import { useTheme } from "next-themes";

type ThemedDemoFrameProps = IframeHTMLAttributes<HTMLIFrameElement> & {
  src: string;
};

const FALLBACK_ORIGIN = "https://shell-docs.local";

function isAbsoluteUrl(src: string) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src);
}

export function withDocsThemeParam(src: string, theme: "dark" | "light") {
  try {
    const absolute = isAbsoluteUrl(src);
    const url = new URL(src, FALLBACK_ORIGIN);
    url.searchParams.set("theme", theme);
    url.searchParams.set("colorScheme", theme);

    if (absolute) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}theme=${theme}&colorScheme=${theme}`;
  }
}

export function ThemedDemoFrame({
  src,
  style,
  sandbox = "allow-scripts allow-forms allow-popups",
  ...props
}: ThemedDemoFrameProps) {
  const { resolvedTheme } = useTheme();
  const docsTheme = resolvedTheme === "dark" ? "dark" : "light";
  const themedSrc = useMemo(
    () => withDocsThemeParam(src, docsTheme),
    [src, docsTheme],
  );

  const themedStyle: CSSProperties = {
    ...style,
    colorScheme: docsTheme,
  };

  return (
    <iframe src={themedSrc} style={themedStyle} sandbox={sandbox} {...props} />
  );
}
