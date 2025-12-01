function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "0.0.0.0"
  );
}

export function shouldShowDevConsole(showDevConsole?: boolean): boolean {
  // DEPRECATED: The showDevConsole prop is deprecated for the new Inspector.
  // The Inspector is now always enabled by default and can only be hidden via
  // the "Disable inspector" option in the Inspector menu itself.
  // This ensures everyone sees the new Inspector UI on upgrade.

  // Always show the inspector (ignoring the deprecated showDevConsole prop)
  return true;
}
