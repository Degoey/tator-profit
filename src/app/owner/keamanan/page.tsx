import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OwnerPasskeyEnrollment } from "@/components/owner/owner-passkey-enrollment";
import { OwnerSecurityActions } from "@/components/owner/owner-security-actions";
import { OwnerShell } from "@/components/owner/owner-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadOwnerContext } from "@/lib/auth/owner-guard";
import {
  listOwnerPasskeys,
  listOwnerSessions,
  ownerPasskeyStatus,
} from "@/lib/services/owner-passkey-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Keamanan pemilik" };

/**
 * Halaman keamanan pemilik: pendaftaran sidik jari (passkey), status kredensial, dan
 * daftar sesi. Halaman ini juga satu-satunya yang boleh dibuka saat passkey belum
 * terdaftar — justru di situlah pendaftarannya dilakukan.
 */
export default async function OwnerSecurityPage() {
  const context = await loadOwnerContext();

  if (context.kind === "unconfigured" || context.kind === "forbidden") notFound();
  if (context.kind === "guest") redirect("/login?next=%2Fowner%2Fkeamanan");
  if (context.kind === "step-up") redirect("/owner/masuk");

  const owner = context.actor;
  const status = await ownerPasskeyStatus(owner.id);
  const credentials = await listOwnerPasskeys(owner.id);
  const sessions = await listOwnerSessions(owner.id);

  return (
    <OwnerShell
      active="/owner/keamanan"
      title="Keamanan pemilik"
      description="Kata sandi saja tidak cukup untuk konsol pemilik: sidik jari (passkey WebAuthn) wajib terdaftar, dan setiap verifikasi berlaku terbatas per sesi."
      ownerLabel={`@${owner.username}`}
    >
      <section className="flex flex-wrap items-center gap-2">
        <Badge variant={status.enabled ? "default" : "danger"}>
          {status.enabled ? "Sidik jari aktif" : "Sidik jari belum terdaftar"}
        </Badge>
        <Badge variant="muted">
          {status.credentialCount} kredensial terdaftar
        </Badge>
        {owner.stepUpVerifiedAt ? (
          <Badge variant="muted">
            Sesi ini terverifikasi {new Date(owner.stepUpVerifiedAt).toLocaleString("id-ID")}
          </Badge>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{status.enabled ? "Sidik jari sudah aktif" : "Daftarkan sidik jari"}</CardTitle>
          <CardDescription>
            Hanya kunci publik yang disimpan di server; kunci privat tetap di perangkatmu. Verifikasi
            berikutnya ditandatangani perangkat, jadi salinan database tidak cukup untuk menirunya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.enabled ? (
            <OwnerSecurityActions
              credentials={credentials.map((credential) => ({
                credentialId: credential.credentialId,
                friendlyName: credential.friendlyName,
                deviceType: credential.deviceType,
                backedUp: credential.backedUp,
                createdAt: credential.createdAt.toISOString(),
                lastUsedAt: credential.lastUsedAt ? credential.lastUsedAt.toISOString() : null,
              }))}
            />
          ) : (
            <OwnerPasskeyEnrollment account={owner.email} />
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
