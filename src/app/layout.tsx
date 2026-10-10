import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

export const metadata: Metadata = {
  title: {
    default: "Tatorprofit — Platform Program Imbalan",
    template: "%s | Tatorprofit",
  },
  description:
    "Tatorprofit adalah platform program imbalan dengan pilihan gabung mulai 10 USDT. Imbalan mengikuti ketentuan program, bukan jaminan hasil.",
  applicationName: "Tatorprofit",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  /**
   * The icon set is produced by `npm run icons` and declared here as well as in
   * `src/app/manifest.ts`, so browsers that ignore the manifest still show the
   * brand mark in the tab and on a home-screen shortcut.
   */
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Tatorprofit",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: "Tatorprofit — Mulai dari 10 USDT",
    description:
      "Pilihan paket gabung dari 10 USDT hingga 10.000 USDT, durasi 4, 8, atau 12 minggu. Imbalan mengikuti ketentuan program dan bukan jaminan hasil.",
    type: "website",
  },
};

/**
 * Kept separate from `metadata` because Next.js deprecated `themeColor` there.
 * The value matches `--color-ink` so the installed app's status bar blends into
 * the dark shell instead of flashing white.
 */
export const viewport: Viewport = {
  themeColor: "#04070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
