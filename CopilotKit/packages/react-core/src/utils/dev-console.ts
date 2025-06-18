export function shouldShowDevConsole(showDevConsole: boolean | "auto"): boolean {
  if (typeof showDevConsole === "boolean") {
    return showDevConsole;
  }

  // Auto mode: check if we're running on localhost
  const hostname = getHostname();
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
}

function getHostname(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.hostname;
}
