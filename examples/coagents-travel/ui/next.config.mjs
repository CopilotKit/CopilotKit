/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["thread-stream", "pino", "pino-pretty"],
};

export default nextConfig;
