import { DOCS_GHCR_IMAGE } from "./docs-prod-pin";
import { domainFor, SERVICES, STAGING_ENV_ID } from "./railway-envs";
import {
  readExpectedImage,
  verifyImageDeployment,
} from "./verify-image-deployment";
import type {
  ExpectedImage,
  VerifyImageOptions,
} from "./verify-image-deployment";

export type ExpectedDocsImage = ExpectedImage;

/** Read this build's docs image, refusing superseded or unrelated references. */
export async function readExpectedDocsImage(
  image: string,
  inspect?: Parameters<typeof readExpectedImage>[2],
): Promise<ExpectedDocsImage> {
  if (!image.startsWith(`${DOCS_GHCR_IMAGE}:`)) {
    throw new Error(
      "docs verification requires the full built commit image reference",
    );
  }
  return readExpectedImage(
    image,
    { requireCommit: true, checkLatest: true, label: "docs" },
    inspect,
  );
}

/** Verify the exact docs deployment/image before checking its serving routes. */
export async function verifyDocsDeployment(
  token: string,
  deploymentId: string,
  expected: ExpectedDocsImage,
  options: VerifyImageOptions = {},
): Promise<{ imageDigest: string }> {
  const { imageDigest } = await verifyImageDeployment(
    token,
    deploymentId,
    expected,
    {
      serviceId: SERVICES.docs.serviceId,
      environmentId: STAGING_ENV_ID,
      label: "docs",
    },
    options,
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  for (const [path, marker] of [
    ["/generative-ui/components", "Let your agent render your own components"],
    ["/generative-ui/components/standard-catalog", "standardUI"],
  ]) {
    const response = await fetchImpl(
      `https://${domainFor("docs", "staging")}${path}`,
      {
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`docs ${path} returned HTTP ${response.status}`);
    }
    if (!(await response.text()).includes(marker))
      throw new Error(`docs ${path} is missing expected content`);
  }
  return { imageDigest };
}
