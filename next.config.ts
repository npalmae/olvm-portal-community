import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@novnc/novnc", "ws"],
};

export default nextConfig;
