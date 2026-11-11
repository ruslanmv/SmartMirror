import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No other site may frame the app.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Next blocks dev assets from 127.0.0.1 unless the host is listed. `pnpm dev`
  // is opened both as localhost and as 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@smartmirror/ui", "@smartmirror/device-capabilities"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: "/pairing", destination: "/smartmirror/pairing", permanent: false },
      // The Echo Show simulator was retired; old links open the real app.
      { source: "/simulator", destination: "/smartmirror", permanent: false },
      { source: "/simulator/:path*", destination: "/smartmirror", permanent: false },
    ];
  },
};

export default nextConfig;
