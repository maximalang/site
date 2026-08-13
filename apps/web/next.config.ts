import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/server/security-headers";

const appDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: join(appDirectory, "../.."),
  outputFileTracingIncludes: {
    "/*": ["../../packages/postgres-store/migrations/*.sql"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(process.env.NODE_ENV),
      },
    ];
  },
};

export default nextConfig;
