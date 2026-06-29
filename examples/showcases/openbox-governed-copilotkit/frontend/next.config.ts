import type { NextConfig } from "next";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath =
  rawBasePath && rawBasePath !== "/"
    ? rawBasePath.replace(/\/+$/, "")
    : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  serverExternalPackages: ["@copilotkit/runtime"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
