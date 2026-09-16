import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The dev-mode "N" badge floats over the bottom-left corner of the app, which
   * puts it inside every screen recording. Off here rather than cropped out of
   * the video, so the frame stays the real viewport.
   */
  devIndicators: false,
};

export default nextConfig;
