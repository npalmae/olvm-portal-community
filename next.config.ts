import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.experiments = {
      ...(config.experiments || {}),
      topLevelAwait: true,
    };
    return config;
  },
};

export default nextConfig;
