import { useLoaderData } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

/**
 * The desk runs in one of two modes. Stateful needs all three keys: Clerk's
 * two (sign-in, connected apps) and Intelligence's (kept threads). Without
 * them it is stateless: the same agent, nothing kept, no sign-in.
 */
export type Features = { stateful: boolean };

const set = (value: string | undefined) => Boolean(value?.trim());

/** Read on the server, where the keys are. */
export function serverFeatures(): Features {
  const env = typeof process === "undefined" ? {} : process.env;
  // The publishable key is inlined into the client bundle at build, so a key
  // baked in then counts as well as one in the server's environment.
  const publishableKey =
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
    env.VITE_CLERK_PUBLISHABLE_KEY;
  return {
    stateful:
      set(publishableKey) &&
      set(env.CLERK_SECRET_KEY) &&
      set(env.CPK_INTELLIGENCE_API_KEY),
  };
}

const getFeatures = createServerFn({ method: "GET" }).handler(() =>
  serverFeatures(),
);

let features: Promise<Features> | undefined;
/** The features, fetched once per page load (the keys only change on restart). */
export const loadFeatures = () => (features ??= getFeatures());

/** The features, as the root route loaded them. */
export const useFeatures = (): Features => useLoaderData({ from: "__root__" });
