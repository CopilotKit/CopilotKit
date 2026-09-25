export type RuntimeUrlType =
  | "missing"
  | "relative"
  | "localhost"
  | "same_origin"
  | "remote"
  | "invalid";

export function getRuntimeUrlType(
  runtimeUrl: string | undefined,
): RuntimeUrlType {
  if (!runtimeUrl) return "missing";
  if (runtimeUrl.startsWith("/") && !runtimeUrl.startsWith("//")) {
    return "relative";
  }

  try {
    const baseHref =
      typeof window !== "undefined"
        ? window.location.href
        : "https://copilotkit.ai";
    const url = new URL(runtimeUrl, baseHref);
    const baseUrl = new URL(baseHref);
    const hostname = url.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    ) {
      return "localhost";
    }

    return url.origin === baseUrl.origin ? "same_origin" : "remote";
  } catch {
    return "invalid";
  }
}
