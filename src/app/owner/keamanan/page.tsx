import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OwnerSecurityActions } from "@/components/owner/owner-security-actions";
import { OwnerShell } from "@/components/owner/owner-shell";
import { OwnerTotpEnrollment } from "@/components/owner/owner-totp-enrollment";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadOwnerContext } from "@/lib/auth/owner-guard";
import { OWNER_2FA_KEY_ENV } from "@/lib/config/owner";
import { isOwnerSecretBoxConfigured } from "@/lib/owner/secret-box";
import { listOwnerSessions, ownerTotpStatus } from "@/lib/services/owner-2fa-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Keamanan pemilik" };

/**
 * Halaman keamanan pemilik: pendaftaran 2FA, statusnya, kode pemulihan, dan daftar
 * sesi. Halaman ini juga satu-satunya yang boleh dibuka saat 2FA belum aktif —
 * justru di situlah pendaftarannya dilakukan.
 */
export default async function OwnerSecurityPage() {
  const context = await loadOwnerContext();

  if (context.kind === "unconfigured" || context.kind === "forbidden") notFound();
  if (context.kind === "guest") redirect("/login?next=%2Fowner%2Fkeamanan");
  if (context.kind === "step-up") redirect("/owner/masuk");

  const owner = context.actor;
  const status = await ownerTotpStatus(owner.id);
  const keyConfigured = isOwnerSecretBoxConfigured();

  const sessions = await listOwnerSessions(owner.id);

  return (
    <OwnerShell
      active="/owner/keamanan"
      title="Keamanan pemilik"
      description="Kata sandi saja tidak cukup untuk konsol pemilik: 2FA berbasis waktu (TOTP) wajib aktif, dan setiap verifikasi berlaku terbatas per sesi."
      ownerLabel={`@${owner.username}`}
    >
      <section className="flex flex-wrap items-center gap-2">
        <Badge variant={status.enabled ? "default" : "danger"}>
          {status.enabled ? "2FA aktif" : status.pendingEnrollment ? "2FA belum dikonfirmasi" : "2FA belum aktif"}
        </Badge>
        {status.enabledAt ? (
          <Badge variant="muted">
            Aktif sejak {new Date(status.enabledAt).toLocaleString("id-ID")}
          </Badge>
        ) : null}
        <Badge variant="muted">{status.remainingRecoveryCodes} kode pemulihan tersisa</Badge>
        {owner.stepUpVerifiedAt ? (
          <Badge variant="muted">
            Sesi ini terverifikasi {new Date(owner.stepUpVerifiedAt).toLocaleString("id-ID")}
          </Badge>
        ) : null}
      </section>

      {!keyConfigured ? (
        <Alert variant="danger" title="Kunci enkripsi 2FA belum diisi">
          Variabel lingkungan {OWNER_2FA_KEY_ENV} (64 karakter heksadesimal) belum ada, jadi rahasia 2FA
          tidak dapat disimpan dengan aman. Pendaftaran 2FA akan ditolak sampai kunci itu diisi di
          server.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{status.enabled ? "2FA sudah aktif" : "Daftarkan aplikasi autentikator"}</CardTitle>
          <CardDescription>
            Rahasia TOTP disimpan terenkripsi (AES-256-GCM) di database, dan satu kode hanya dapat
            dipakai sekali.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.enabled ? (
            <OwnerSecurityActions remainingRecoveryCodes={status.remainingRecoveryCodes} />
          ) : (
            <OwnerTotpEnrollment account={owner.email} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sesi akun pemilik</CardTitle>
          <CardDescription>
            Sepuluh sesi terakhir. Sesi yang tidak dikenal dapat dihentikan lewat tombol &ldquo;Cabut
            semua sesi lain&rdquo; di atas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {sessions.map((session) => {
              const current = session.id === owner.sessionId;
              return (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
                >
                  <span className="flex items-center gap-2">
                    {current ? <Badge variant="default">Sesi ini</Badge> : null}
                    {session.revokedAt ? <Badge variant="danger">Dicabut</Badge> : null}
                    {session.expired ? (
                      <Badge variant="muted">Kedaluwarsa</Badge>
                    ) : null}
                    <span className="text-white/70">{session.ipAddress ?? "IP tidak tercatat"}</span>
                  </span>
                  <span className="max-w-[22rem] truncate text-white/45" title={session.userAgent ?? ""}>
                    {session.userAgent ?? "Peramban tidak dikenal"}
                  </span>
                  <span className="text-white/40">
                    Dibuat {session.createdAt.toLocaleString("id-ID")}
                    {session.lastUsedAt
                      ? ` · dipakai ${session.lastUsedAt.toLocaleString("id-ID")}`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </OwnerShell>
  );
}
