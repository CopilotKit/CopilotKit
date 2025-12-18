/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["thread-stream", "pino", "pino-pretty"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push("pino", "pino-pretty", "thread-stream");
    }
    return config;
  },
};

export default nextConfig;
