function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "0.0.0.0"
  );
}

export function shouldShowDevConsole(showDevConsole?: boolean): boolean {
  // If explicitly set, use that value
  if (showDevConsole !== undefined) {
    return showDevConsole;
  }

  // If not set, default to true on localhost
  return isLocalhost();
}
