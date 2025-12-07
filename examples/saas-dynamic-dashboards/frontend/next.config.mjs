/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
