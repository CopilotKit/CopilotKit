const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";

export const basePath =
  rawBasePath && rawBasePath !== "/" ? rawBasePath.replace(/\/+$/, "") : "";

export function withBasePath(path: string) {
  if (!path) return basePath || "/";
  if (/^(https?:)?\/\//.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}
