import type { MetadataRoute } from "next";

/**
 * Web app manifest, served by Next.js at `/manifest.webmanifest`.
 *
 * This is what turns the existing administrator surface into an installable app:
 * an administrator opens `/admin` on Android or iOS, chooses "Install app" (or
 * "Add to Home screen"), and gets a standalone window with its own launcher
 * icon. No backend change is involved: the same session cookie, the same
 * `/api/admin/*` endpoints and the same server-side permission checks are used.
 *
 * `start_url` points at the admin queue because this manifest is offered from
 * the admin surface; a member who installs it anyway is redirected to
 * `/dashboard` by the server guard in `src/lib/auth/current-user.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "Tatorprofit Admin",
    short_name: "TP Admin",
    description:
      "Panel administrasi Tatorprofit: tinjau setoran dan penarikan, kredit saldo, dan periksa jejak audit.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "id",
    dir: "ltr",
    background_color: "#04070a",
    theme_color: "#04070a",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Tinjauan deposit", short_name: "Deposit", url: "/admin#deposit" },
      { name: "Tinjauan penarikan", short_name: "Penarikan", url: "/admin#penarikan" },
      { name: "Kredit saldo", short_name: "Kredit", url: "/admin#kredit" },
      { name: "Jejak audit", short_name: "Audit", url: "/admin#audit" },
    ],
  };
}
