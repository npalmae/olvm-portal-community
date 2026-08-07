import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["undici"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  devIndicators: {
    appIsrStatus: false,
    buildActivity: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10gb",
    },
  },
  webpack: (config) => {
    config.experiments = {
      ...(config.experiments || {}),
      topLevelAwait: true,
    };
    config.module.rules.push({
      test: /@novnc\/novnc\/lib\/.*\.js$/,
      type: "javascript/auto",
      parser: {
        topLevelAwait: true,
      },
    });
    return config;
  },
};

export default nextConfig;
