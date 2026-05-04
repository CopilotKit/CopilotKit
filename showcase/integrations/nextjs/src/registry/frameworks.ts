// showcase/integrations/nextjs/src/registry/frameworks.ts

export function maybeEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export type FrameworkSlug = string;
export type FrameworkLanguage = "python" | "typescript" | "dotnet" | "java";

export type FrameworkConfig = {
  slug: FrameworkSlug;
  name: string;
  language: FrameworkLanguage;
  backendUrl: string;
};

export const frameworks: Record<FrameworkSlug, FrameworkConfig> = {};

export function isReachable(fw: FrameworkConfig): boolean {
  return fw.backendUrl !== "";
}
