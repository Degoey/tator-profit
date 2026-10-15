import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OwnerShell } from "@/components/owner/owner-shell";
import { OwnerStepUpForm } from "@/components/owner/owner-step-up-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadOwnerContext } from "@/lib/auth/owner-guard";
import { ownerStepUpMinutes } from "@/lib/config/owner";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verifikasi 2FA" };

/**
 * Halaman verifikasi sesi. Hanya masuk akal pada keadaan `step-up` (2FA aktif
 * tetapi sesi ini belum diverifikasi); keadaan lain dialihkan ke tempat yang
 * benar supaya halaman ini tidak menjadi jalan memutar.
 */
export default async function OwnerStepUpPage() {
  const context = await loadOwnerContext();

  if (context.kind === "unconfigured" || context.kind === "forbidden") notFound();
  if (context.kind === "guest") redirect("/login?next=%2Fowner");
  if (context.kind === "enrollment") redirect("/owner/keamanan");
  if (context.kind === "ready") redirect("/owner");

  const { actor } = context;

  return (
    <OwnerShell
      active="/owner"
      title="Verifikasi 2FA"
      description="Konsol Pemilik meminta kode dari aplikasi autentikator sebelum membuka data keuangan dan antrean uang."
      ownerLabel={`@${actor.username}`}
    >
      <Card>
        <CardHeader>
          <CardTitle>Masukkan kode 2FA</CardTitle>
          <CardDescription>
            Verifikasi berlaku {ownerStepUpMinutes()} menit untuk sesi ini. Setelah itu konsol meminta
            kode baru.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerStepUpForm ownerEmail={actor.email} />
        </CardContent>
      </Card>
    </OwnerShell>
  );
}
