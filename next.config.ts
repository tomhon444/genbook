import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production" &&
  (process.env.AUTH_PROVIDER === "local" || process.env.LOCAL_IDENTITY_URL || process.env.LOCAL_IDENTITY_SECRET)) {
  throw new Error("Local identity configuration is forbidden in production");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.NODE_ENV === "development" && ["t04", "t05", "t07", "t08", "t09", "t10", "t12-details"].includes(process.env.NEXT_TEST_DIST ?? "")
    ? `.local/next-${process.env.NEXT_TEST_DIST}` : ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
