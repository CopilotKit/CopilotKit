export function shouldShowDevConsole(showDevConsole: boolean | "auto"): boolean {
  if (typeof showDevConsole === "boolean") {
    return showDevConsole;
  }

  // Auto mode: check if we're running on localhost or in development
  const hostname = getHostname();
  const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
  const isDevelopment = process.env.NODE_ENV === "development";

  const result = isLocalhost || isDevelopment;
  console.log(
    "🐛 shouldShowDevConsole - hostname:",
    hostname,
    "NODE_ENV:",
    process.env.NODE_ENV,
    "result:",
    result,
  );
  return result;
}

function getHostname(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.hostname;
}
