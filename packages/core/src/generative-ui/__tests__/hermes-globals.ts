// Test helper: makes the globals look like React Native on Hermes, where
// Node and jsdom have more. Hermes has no structuredClone, no DOMException,
// no Error.isError and no Intl.PluralRules (facebook/hermes doc/IntlAPIs.md
// lists only Collator, NumberFormat and DateTimeFormat). On React Native
// `window` is the global object, with no `open` and no `location`, unless
// the app installs `@copilotkit/react-native/polyfills/location`, which sets
// `location.href` to "http://react-native.invalid". `navigator` is
// `{ product: "ReactNative" }` (Libraries/Core/setUpNavigator.js), with no
// `language`. `URL` is React Native's own class (Libraries/Blob/URL.js), not
// the WHATWG one; see RN_URL_MODELS.
//
// Error `cause` support (ErrorOptions) cannot be removed here: replacing the
// global Error breaks `instanceof` everywhere. The source scan in
// hermes-globals.test.ts bans ErrorOptions on the native path instead.

/** The `validateBaseUrl` of RN's URL.js, the same in 0.70 to 0.88. */
function validateBaseUrl(url: string) {
  // from this MIT-licensed gist: https://gist.github.com/dperini/729294
  return /^(?:(?:(?:https?|ftp):)?\/\/)(?:(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9¡-￿][a-z0-9¡-￿_-]{0,62})?[a-z0-9¡-￿]\.)*(?:[a-z¡-￿]{2,}\.?))(?::\d{2,5})?(?:[/?#]\S*)?$/.test(
    url,
  );
}

/** The base-URL branch of the RN constructor, the same in 0.70 to 0.88. */
function joinBase(url: string, base: string | { toString(): string }) {
  let baseUrl: string;
  if (typeof base === "string") {
    baseUrl = base;
    if (!validateBaseUrl(baseUrl)) {
      throw new TypeError(`Invalid base URL: ${baseUrl}`);
    }
  } else {
    baseUrl = base.toString();
  }
  if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, baseUrl.length - 1);
  let path = url;
  if (!path.startsWith("/")) path = `/${path}`;
  if (baseUrl.endsWith(path)) path = "";
  return `${baseUrl}${path}`;
}

const notImplemented = (name: string) => () => {
  throw new Error(`URL.${name} is not implemented`);
};

/**
 * RN 0.72.17 Libraries/Blob/URL.js (the same in 0.70.15 to 0.79.6): the
 * constructor never throws without a base, and every getter but `href`
 * throws "not implemented". Blob and searchParams parts left out.
 */
export class ReactNativeLegacyURL {
  _url: string;

  constructor(url: string, base?: string | { toString(): string }) {
    if (!base || validateBaseUrl(url)) {
      this._url = url;
      if (!this._url.endsWith("/")) this._url += "/";
    } else {
      this._url = joinBase(url, base);
    }
  }

  get href() {
    return this.toString();
  }

  toJSON() {
    return this.toString();
  }

  toString() {
    return this._url;
  }
}
for (const name of [
  "hash",
  "host",
  "hostname",
  "origin",
  "password",
  "pathname",
  "port",
  "protocol",
  "search",
  "username",
]) {
  Object.defineProperty(ReactNativeLegacyURL.prototype, name, {
    get: notImplemented(name),
    configurable: true,
  });
}

/**
 * RN 0.88.1 Libraries/Blob/URL.js (getters by regex since 0.80): the
 * constructor never throws without a base, `protocol` keeps the case of
 * the input and is "" when there is none. Blob and searchParams parts left
 * out.
 */
export class ReactNativeURL {
  _url: string;

  constructor(url: string, base?: string | { toString(): string }) {
    if (!base || validateBaseUrl(url)) {
      this._url = url;
      if (this._url.includes("#")) {
        const split = this._url.split("#");
        const beforeHash = split[0]!;
        const website = beforeHash.split("://")[1]!;
        // As in RN: a TypeError when there is no "://" before the "#".
        if (!website.includes("/")) this._url = split.join("/#");
      }
      if (
        !this._url.endsWith("/") &&
        !(this._url.includes("?") || this._url.includes("#"))
      ) {
        const afterProtocol = this._url.split("://")[1];
        if (afterProtocol && !afterProtocol.includes("/")) this._url += "/";
      }
    } else {
      this._url = joinBase(url, base);
    }
  }

  get hash() {
    const hashMatch = this._url.match(/#([^/]*)/);
    return hashMatch ? `#${hashMatch[1]}` : "";
  }

  get host() {
    const hostMatch = this._url.match(/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/);
    const portMatch = this._url.match(/:(\d+)(?=[/?#]|$)/);
    return hostMatch
      ? hostMatch[1] + (portMatch ? `:${portMatch[1]}` : "")
      : "";
  }

  get hostname() {
    const hostnameMatch = this._url.match(/^https?:\/\/(?:[^@]+@)?([^:/?#]+)/);
    return hostnameMatch ? hostnameMatch[1]! : "";
  }

  get href() {
    return this.toString();
  }

  get origin() {
    const matches = this._url.match(/^(https?:\/\/[^/]+)/);
    return matches ? matches[1]! : "";
  }

  get pathname() {
    const pathMatch = this._url.match(/https?:\/\/[^/]+(\/[^?#]*)?/);
    return pathMatch ? pathMatch[1] || "/" : "/";
  }

  get port() {
    const portMatch = this._url.match(/:(\d+)(?=[/?#]|$)/);
    return portMatch ? portMatch[1]! : "";
  }

  get protocol() {
    const protocolMatch = this._url.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):/);
    return protocolMatch ? protocolMatch[1] + ":" : "";
  }

  get search() {
    const searchMatch = this._url.match(/\?([^#]*)/);
    return searchMatch ? `?${searchMatch[1]}` : "";
  }

  toJSON() {
    return this.toString();
  }

  toString() {
    return this._url;
  }
}

/** The React Native URL classes the helper can install. */
export const RN_URL_MODELS = {
  "0.72": ReactNativeLegacyURL,
  "0.88": ReactNativeURL,
} as const;

export interface HermesGlobalsOptions {
  /** Install the location polyfill of @copilotkit/react-native. */
  locationPolyfill?: boolean;
  /** The `location.href` the polyfill gives (another app's polyfill). */
  locationHref?: string;
  /** Give `window` an `open`, as an app may do. */
  open?: (...args: unknown[]) => unknown;
  /** Which React Native URL class to install. Default "0.88". */
  url?: keyof typeof RN_URL_MODELS;
  /** Also remove `Intl`, as a Hermes build without Intl has none. */
  noIntl?: boolean;
}

/** The globals that the helper removes or replaces. */
export const HERMES_MISSING_GLOBALS = [
  "structuredClone",
  "DOMException",
  "Error.isError",
  "Intl.PluralRules",
  "navigator.language",
  "URL (React Native's own class)",
  "window.location",
  "window.open",
] as const;

/** Puts a property back as it was, or deletes it when it was absent. */
function putBack(
  target: object,
  name: string,
  saved: PropertyDescriptor | undefined,
) {
  if (saved) Object.defineProperty(target, name, saved);
  else delete (target as Record<string, unknown>)[name];
}

/**
 * Removes the globals that Hermes lacks and points `window` at the global
 * object. Returns the function that restores everything. When a step
 * fails, what was already changed is restored before the error is thrown.
 */
export function installHermesGlobals(options: HermesGlobalsOptions = {}) {
  const restores: (() => void)[] = [];
  const restoreAll = () => {
    const errors: unknown[] = [];
    while (restores.length > 0) {
      try {
        restores.pop()!();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "could not restore every global");
    }
  };
  const remove = (target: object, name: string) => {
    const saved = Object.getOwnPropertyDescriptor(target, name);
    delete (target as Record<string, unknown>)[name];
    restores.push(() => putBack(target, name, saved));
  };
  const define = (target: object, name: string, value: unknown) => {
    const saved = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    restores.push(() => putBack(target, name, saved));
  };

  try {
    remove(globalThis, "structuredClone");
    remove(globalThis, "DOMException");
    remove(Error, "isError");
    remove(Intl, "PluralRules");
    if (options.noIntl) remove(globalThis, "Intl");
    remove(globalThis, "location");
    remove(globalThis, "open");
    define(globalThis, "window", globalThis);
    define(globalThis, "navigator", { product: "ReactNative" });
    define(globalThis, "URL", RN_URL_MODELS[options.url ?? "0.88"]);
    if (options.locationPolyfill) {
      const href = options.locationHref ?? "http://react-native.invalid";
      const hostname = href.replace(/^\w+:\/\/|[/:].*$/g, "");
      define(globalThis, "location", {
        hostname,
        href,
        origin: href.replace(/\/$/, ""),
        protocol: "http:",
        host: hostname,
        pathname: "/",
        search: "",
        hash: "",
        port: "",
      });
    }
    if (options.open) define(globalThis, "open", options.open);
  } catch (error) {
    restoreAll();
    throw error;
  }

  return restoreAll;
}

/** True when the globals look like Hermes, for a precondition check. */
export function looksLikeHermes() {
  const scope = globalThis as Record<string, unknown>;
  return (
    typeof scope.structuredClone === "undefined" &&
    typeof scope.DOMException === "undefined" &&
    typeof (Error as { isError?: unknown }).isError === "undefined" &&
    typeof (scope.Intl as { PluralRules?: unknown } | undefined)
      ?.PluralRules === "undefined" &&
    (scope.navigator as { product?: unknown }).product === "ReactNative" &&
    (scope.navigator as { language?: unknown }).language === undefined &&
    Object.values(RN_URL_MODELS).includes(scope.URL as never) &&
    scope.window === globalThis
  );
}
