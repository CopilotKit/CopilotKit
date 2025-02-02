export function shouldShowDevConsole(showDevConsole: boolean | "auto"): boolean {
  if (typeof showDevConsole === "boolean") {
    return showDevConsole;
  }
  return (
    getHostname() === "localhost" ||
    getHostname() === "127.0.0.1" ||
    getHostname() === "0.0.0.0" ||
    getHostname() === "::1"
  );
}

function getHostname(): string {
  if (typeof window !== "undefined" && window.location) {
    return window.location.hostname;
  }
  return "";
}
