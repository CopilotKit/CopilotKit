/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle the SDK's global KaTeX CSS for the Pages Router.
  transpilePackages: ["@copilotkit/react-core"],
  experimental: {
    // react-syntax-highlighter's CommonJS entry loads ESM refractor languages.
    esmExternals: "loose",
  },
};

export default nextConfig;
