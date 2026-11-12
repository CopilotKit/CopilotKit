declare const __LEARNING_VERSION__: string | undefined;

/** This package's version, set at build time. "unknown" in an unbuilt copy. */
export const LEARNING_VERSION: string =
  typeof __LEARNING_VERSION__ === "string" ? __LEARNING_VERSION__ : "unknown";

/** Version fields of the start `page` event: this SDK's version, plus the app's when configured. */
export function appContext(appVersion: string | undefined) {
  return {
    sdkVersion: LEARNING_VERSION,
    ...(typeof appVersion === "string" && appVersion.trim()
      ? { appVersion: appVersion.slice(0, 200) }
      : {}),
  };
}
