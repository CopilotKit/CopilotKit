import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
import { localBackendsEnv } from "./src/lib/local-backends-env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_PORTS_PATH = path.resolve(
  __dirname,
  "..",
  "shared",
  "local-ports.json",
);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_LOCAL_BACKENDS: localBackendsEnv(LOCAL_PORTS_PATH),
  },
};

export default nextConfig;
