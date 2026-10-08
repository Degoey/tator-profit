import type { NextConfig } from "next";

/**
 * Baseline security headers for a financial surface.
 *
 * A full CSP is intentionally left to the deployment layer (Next injects inline
 * bootstrap scripts, so a wrong policy would break the app); the headers below
 * are safe everywhere and already block MIME sniffing, framing, referrer
 * leakage and device APIs.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Payment proofs are private files: never cache them anywhere.
        source: "/api/deposits/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
