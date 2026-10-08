import { ArrowLeft, Share2 } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { loadReferralOverview } from "@/app/referral/overview";
import { ReferralCodeCard } from "@/components/referral/referral-code-card";
import { ReferralCommissionTable } from "@/components/referral/referral-commission-table";
import { ReferralMemberTable } from "@/components/referral/referral-member-table";
import { ReferralSummary } from "@/components/referral/referral-summary";
import { ReferralTree } from "@/components/referral/referral-tree";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Rujukan",
  description:
    "Kode rujukan, pohon jaringan lima generasi, dan tabel komisi rujukan akun Tatorprofit Anda.",
};

export const dynamic = "force-dynamic";

/**
 * Absolute origin for the share link, resolved on the server so the first paint
 * already contains a complete link (no `window` dependency, no hydration drift).
 */
async function resolveOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";

  if (host) return `${protocol}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "";
}

export default async function ReferralPage() {
  const user = await requireUser("/referral");

  const [overview, origin] = await Promise.all([
    loadReferralOverview({
      id: user.id,
      username: user.username,
      referralCode: user.referralCode,
    }),
    resolveOrigin(),
  ]);

  const directReferrals = overview.network.counts[0] ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-5 py-10">
        <section className="card-glow rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="gold">
                <Share2 className="size-3.5" aria-hidden />
                Program rujukan
              </Badge>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Jaringan rujukan Anda
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-white/60">
                Lima tingkat rujukan, satu konfigurasi terpusat. Halaman ini hanya menampilkan data
                milik akun @{user.username}; jaringan pengguna lain tidak dapat dibuka dari sini.
              </p>
            </div>

            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">
                <ArrowLeft aria-hidden />
                Kembali ke dasbor
              </Link>
            </Button>
          </div>
        </section>

        <ReferralCodeCard referralCode={overview.referralCode} origin={origin} />

        <ReferralSummary
          directReferrals={directReferrals}
          totalNetwork={overview.network.total}
          levels={overview.levels}
          totals={overview.totals}
          truncated={overview.network.truncated}
        />

        <ReferralTree network={overview.network} levels={overview.levels} />

        <ReferralMemberTable members={overview.members} levels={overview.levels} />

        <ReferralCommissionTable commissions={overview.commissions} />

        <Alert variant="info" title="Ketentuan rujukan">
          Hubungan rujukan dicatat satu kali saat pendaftaran dan tidak dapat diubah sendiri.
          Komisi rujukan dihitung dengan aritmetika desimal dari transaksi program yang tercatat di
          buku besar dan baru masuk saldo setelah dibayar oleh administrator. Struktur lima tingkat
          ini bukan jaminan pendapatan.
        </Alert>
      </main>

      <SiteFooter />
    </div>
  );
}
