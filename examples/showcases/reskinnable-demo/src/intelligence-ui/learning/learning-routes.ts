/**
 * Container-scoped views inside the Learning workspace.
 *
 * `analysis-results` is the URL segment for what the API calls runs. The
 * product vocabulary is "analysis" because that is what the user asked for;
 * the run is the machinery underneath it.
 */
export const learningTabSegments = [
  'insights',
  'skills',
  'analysis-results',
] as const;

export type LearningTabSegment = (typeof learningTabSegments)[number];

const defaultTab: LearningTabSegment = 'insights';

/**
 * Resolves a URL segment to a Container view.
 *
 * @param value - Raw segment from the route, if any.
 * @returns The named view, or Insights when the segment is absent or unknown.
 */
export function parseLearningTabSegment(
  value: string | null | undefined,
): LearningTabSegment {
  return learningTabSegments.includes(value as LearningTabSegment)
    ? (value as LearningTabSegment)
    : defaultTab;
}

/**
 * Returns whether a segment names a Container view.
 *
 * Used to tell a stale or mistyped view segment apart from a valid one, so the
 * route can canonicalize instead of silently showing Insights.
 *
 * @param value - Raw segment from the route.
 * @returns Whether the segment is a known view.
 */
export function isLearningTabSegment(
  value: string | null | undefined,
): value is LearningTabSegment {
  return learningTabSegments.includes(value as LearningTabSegment);
}

/** Route for the Learning landing view of one project. */
export function learningRoute(baseRoute: string): string {
  return `${baseRoute}/learning`;
}

/**
 * Route for one Container view.
 *
 * The Insights view is the Container's canonical URL, so it carries no view
 * segment. That keeps the address a reader shares as short as possible.
 *
 * @param baseRoute - Project base route.
 * @param containerId - Stable Container id.
 * @param tab - Container view, defaulting to Insights.
 * @returns The Container route.
 */
export function learningContainerRoute(
  baseRoute: string,
  containerId: string,
  tab: LearningTabSegment = defaultTab,
): string {
  const container = `${learningRoute(baseRoute)}/${encodeURIComponent(containerId)}`;
  return tab === defaultTab ? container : `${container}/${tab}`;
}
