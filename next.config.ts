import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["undici"],
  devIndicators: false,
};

export default nextConfig;
