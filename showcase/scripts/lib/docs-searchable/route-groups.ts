export function isRouteGroupSegment(segment: string): boolean {
  return /^\(.+\)$/.test(segment);
}

export function stripRouteGroupSegmentsFromPathname(pathname: string): string {
  const clean = pathname
    .split("/")
    .filter((segment) => segment.length > 0 && !isRouteGroupSegment(segment));
  return `/${clean.join("/")}`;
}
