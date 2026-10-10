import { AtSign, CreditCard, Landmark, Phone, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";

import { ProfileForm } from "@/components/profile/profile-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { CustomerServiceCard } from "@/components/support/customer-service-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current-user";
import { bankLabel } from "@/lib/config/bank-options";
import { getCustomerServiceConfig } from "@/lib/config/support";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Profil",
  description:
    "Profil akun Tatorprofit Anda: nama, kontak, wilayah, zona waktu, kode rujukan, dan ringkasan saldo dalam USDT.",
};

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser("/profile");

  const profile = await prisma.profile.findUnique({
    where: { userId: user.id },
    select: { country: true, city: true, timezone: true, bio: true, referralCode: true },
  });

  // Customer service is WhatsApp-only: the card below opens the chat and nothing about
  // the conversation is stored inside the application.
  const customerService = getCustomerServiceConfig({
    topic: "Akun & keamanan",
    username: user.username,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-5 py-10">
        <section className="card-glow rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <Badge variant="gold">
            <UserRound className="size-3.5" aria-hidden />
            Profil akun
          </Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Profil @{user.username}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
            Perubahan profil divalidasi di server dan dicatat pada jejak audit. Nama pengguna, surel,
            dan kode rujukan bersifat tetap agar riwayat transaksi dan jaringan rujukan tetap dapat
            ditelusuri.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Data akun</CardTitle>
            <CardDescription>Identitas yang tidak dapat diubah sendiri.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                <AtSign className="size-3.5" aria-hidden />
                Nama pengguna
              </p>
              <p className="mt-2 font-mono text-sm text-white">{user.username}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Surel
              </p>
              <p className="mt-2 break-all text-sm text-white">{user.email}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                <Phone className="size-3.5" aria-hidden />
                Nomor telepon terdaftar
              </p>
              <p className="mt-2 font-mono text-sm text-white">{user.phone}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                <Landmark className="size-3.5" aria-hidden />
                Bank/E-Wallet
              </p>
              <p className="mt-2 text-sm text-white">
                {bankLabel(user.bank) || "Belum tersedia"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                <CreditCard className="size-3.5" aria-hidden />
                Nomor rekening
              </p>
              <p className="mt-2 font-mono text-sm text-white">
                {user.bankAccountNumber ?? "Belum tersedia"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                <ShieldCheck className="size-3.5" aria-hidden />
                Kode rujukan
              </p>
              <p className="mt-2 font-mono text-sm text-[var(--color-neon)]">
                {profile?.referralCode ?? user.referralCode ?? "Belum tersedia"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ringkasan saldo</CardTitle>
            <CardDescription>
              Saldo berasal dari entri buku besar; tidak ada penyesuaian langsung tanpa ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Tersedia
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--color-neon)]">
                {formatMoney(user.balance.availableAmount, user.balance.currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Menunggu persetujuan
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--color-gold)]">
                {formatMoney(user.balance.pendingAmount, user.balance.currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Total diperoleh
              </p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatMoney(user.balance.totalEarned, user.balance.currency)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Perbarui profil</CardTitle>
            <CardDescription>
              Bank/E-Wallet, nama, telepon, negara, kota, zona waktu, dan bio dapat diperbarui
              kapan saja.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initial={{
                bank: user.bank ?? "",
                name: user.name,
                phone: user.phone,
                country: profile?.country ?? "",
                city: profile?.city ?? "",
                timezone: profile?.timezone ?? "Asia/Jakarta",
                bio: profile?.bio ?? "",
              }}
            />
          </CardContent>
        </Card>

        <Alert variant="info" title="Catatan">
          Perubahan nomor telepon hanya mengubah data kontak. Perubahan Bank/E-Wallet berlaku untuk
          pembayaran berikutnya. Nama pengguna dan surel tetap agar identitas akun pada buku besar
          dan jejak audit tidak berubah.
        </Alert>

        <CustomerServiceCard
          href={customerService.link}
          location="profil"
          fallback={customerService.fallback}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
