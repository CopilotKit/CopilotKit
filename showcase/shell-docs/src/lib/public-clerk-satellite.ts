export type PublicClerkSatelliteConfig = {
  isSatellite: true;
  domain: string;
  signInUrl: string;
  signUpUrl: string;
  satelliteAutoSync: true;
};

/** Reads the complete public Clerk satellite configuration when enabled. */
export function getPublicClerkSatelliteConfig():
  | PublicClerkSatelliteConfig
  | undefined {
  if (process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE !== "true") {
    return undefined;
  }

  const domain = process.env.NEXT_PUBLIC_CLERK_DOMAIN;
  const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL;

  if (!domain || !signInUrl || !signUpUrl) {
    throw new Error(
      "Public Clerk satellite mode requires NEXT_PUBLIC_CLERK_DOMAIN, NEXT_PUBLIC_CLERK_SIGN_IN_URL, and NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    );
  }

  return {
    isSatellite: true,
    domain,
    signInUrl,
    signUpUrl,
    satelliteAutoSync: true,
  };
}
