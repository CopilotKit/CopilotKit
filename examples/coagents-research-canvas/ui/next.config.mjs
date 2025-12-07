/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  output: "standalone"
};

export default nextConfig;
