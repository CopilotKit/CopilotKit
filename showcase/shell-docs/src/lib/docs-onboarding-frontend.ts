// The `onboardingFrontend` prop every route hands to `DocsPageView`: the docs
// frontend id plus the display name the copied onboarding prompt should call
// that frontend.
//
// The sibling of `docs-onboarding-framework.ts`, and shared by the same
// routes, so the two selections a reader can make in the docs — agent
// framework and frontend — reach the prompt through the same shape.
//
// Resolved from the URL, never from a stored preference: choosing a frontend
// navigates to a different URL, so the URL is what asserts the selection. This
// is the rule `FrameworkSelector` itself applies (`urlFrontend ?? "react"`),
// and the same standard the framework sentence already holds to.

import {
  frontendFromPathname,
  getFrontendOption,
} from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";

/**
 * The `onboardingFrontend` prop for a `DocsPageView`, resolved from the docs
 * URL — or from any leading part of it, since only the first path segment
 * names a frontend.
 *
 * Always returns a value: a URL with no frontend segment is the docs' default
 * `react` frontend, not the absence of a selection — exactly what the frontend
 * selector shows a reader standing on such a page. Frontends the graph has no
 * node for are handled downstream by `frontendPromptSuffix`.
 */
export function onboardingFrontendFor(pathname: string): {
  id: FrontendId;
  name: string;
} {
  const id: FrontendId = frontendFromPathname(pathname) ?? "react";
  return { id, name: getFrontendOption(id).name };
}
