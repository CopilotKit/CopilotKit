/**
 * Polyfill: window.location
 *
 * Required by shouldShowDevConsole (hostname check) and agent runtime
 * URL resolution (window.location.origin). Uses an obviously invalid
 * hostname to avoid tricking localhost-detection code.
 *
 * Skipped if window.location is already defined.
 *
 * Usage:
 *   import "@copilotkit/react-native/polyfills/location";
 */

if (typeof window !== "undefined" && !(window as any).location) {
  (window as any).location = {
    hostname: "react-native.invalid",
    href: "http://react-native.invalid",
    origin: "http://react-native.invalid",
    protocol: "http:",
    host: "react-native.invalid",
    pathname: "/",
    search: "",
    hash: "",
  };
}
