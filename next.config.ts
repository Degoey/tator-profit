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
  /**
   * Hosts allowed to load Next.js *dev* resources (HMR socket, `/_next/*`
   * chunks). Only the dev server consults this list; production builds ignore
   * it. Needed when a phone or Android WebView reaches `npm run dev` through a
   * LAN address, because the dev server otherwise answers those requests with
   * 403 and hot reload never connects.
   *
   * Set DEV_ALLOWED_ORIGINS=10.0.2.2,192.168.1.15 in `.env` to opt in; the
   * default (empty) keeps the stock localhost-only behaviour.
   */
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
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
      {
        // The service worker must never be served stale, otherwise a fixed
        // worker keeps running inside already-installed apps after a deploy.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
