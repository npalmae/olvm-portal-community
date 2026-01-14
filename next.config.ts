import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Linting fails in offline environments; skip during builds so the app can compile.
    ignoreDuringBuilds: true,
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
