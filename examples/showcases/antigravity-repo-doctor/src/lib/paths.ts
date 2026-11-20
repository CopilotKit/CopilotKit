/**
 * Commands and messages often carry absolute workspace paths
 * (/tmp/rd/ws/<thread key>/...). For display only, show them relative to the
 * repository: the per-thread folder under a `ws` root is dropped. The commands
 * that run are never changed.
 */
const WORKSPACE =
  /(?:\/[\w.@+-]+)*\/ws\/[0-9a-f]{10}(\/)?(?=[\s'"`;:,)|&<>]|\/|$)/g;

export function shortPaths(text: string): string {
  return text.replace(WORKSPACE, (_match, slash: string | undefined) =>
    slash ? "" : ".",
  );
}
