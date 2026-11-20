import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal, signed-in-only app that must always read the sheet live: no prerender caching.
  cacheComponents: false,
  partialPrefetching: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
