/**
 * Where the playground lives. open.bot serves it at open.bot/a2ui by passing those requests on to this server
 * (a rewrite in the openbot.co repo), so every page, route and file here sits under BASE_PATH, on open.bot and
 * on Railway's own address alike. next.config.ts imports this file, so it imports nothing itself.
 */
export const BASE_PATH = "/a2ui";

/** The playground's public address: canonical links point here, and the addresses it moved from redirect here. */
export const SITE_URL = "https://open.bot/a2ui";

/** The addresses the playground used to answer on. Every request to one is sent to the same page under SITE_URL. */
export const MOVED_HOSTS = ["a2ui-playground.copilotkit.ai", "a2ui.open.bot"];

/**
 * A path on this site as the browser requests it. Next adds BASE_PATH to <Link>, the router and redirects only;
 * a fetch, a runtimeUrl, a plain <a> or a file in public/ needs it added by hand.
 */
export const withBase = (path: string) =>
  path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
