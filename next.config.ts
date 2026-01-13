import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
