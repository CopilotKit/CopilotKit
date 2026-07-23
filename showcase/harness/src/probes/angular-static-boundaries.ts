function unsafeAssetError(value: string): Error {
  return new Error(
    `Angular document contains an unsafe asset URL: ${JSON.stringify(value)}`,
  );
}

/** Resolve browser asset attributes while enforcing the Angular static root. */
export function resolveAngularAssetUrls(
  serverBaseUrl: string,
  documentBaseUrl: string,
  assetPaths: readonly string[],
): string[] {
  const server = new URL(serverBaseUrl);
  const documentBase = new URL(documentBaseUrl);
  if (
    documentBase.origin !== server.origin ||
    documentBase.pathname !== "/angular/"
  ) {
    throw unsafeAssetError(documentBaseUrl);
  }

  return assetPaths.map((path) => {
    const asset = new URL(path, documentBase);
    if (
      asset.origin !== server.origin ||
      !asset.pathname.startsWith("/angular/") ||
      /^(?:javascript|vbscript):/i.test(path)
    ) {
      throw unsafeAssetError(path);
    }
    return asset.href;
  });
}
