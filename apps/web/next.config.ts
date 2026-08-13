import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/server/security-headers";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
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
