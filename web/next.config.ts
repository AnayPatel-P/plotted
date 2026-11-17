import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The repo is a monorepo: catalog data lives in ../data and the engine in ../packages.
  // Trace from the repo root so serverless functions (e.g. /api/courses) ship the data they read.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/api/courses": ["../data/*/*/courses/*.json"],
    "/*": ["../data/*/*/programs/*.json", "../data/*/*/courses/index.json"],
  },
  turbopack: {
    root: path.join(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
