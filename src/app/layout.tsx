import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tatorprofit — Platform Program Imbalan",
    template: "%s | Tatorprofit",
  },
  description:
    "Tatorprofit adalah platform program imbalan dengan pilihan gabung mulai 10 USDT. Imbalan mengikuti ketentuan program, bukan jaminan hasil.",
  applicationName: "Tatorprofit",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Tatorprofit — Mulai dari 10 USDT",
    description:
      "Pilihan paket gabung dari 10 USDT hingga 10.000 USDT, durasi 4, 8, atau 12 minggu. Imbalan mengikuti ketentuan program dan bukan jaminan hasil.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
