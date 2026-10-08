"use client";

import { Check, Copy, Share2 } from "lucide-react";
import * as React from "react";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface ReferralPanelProps {
  referralCode: string | null;
  directReferrals: number;
  totalNetwork: number;
  levels: { level: number; rate: string }[];
}

export function ReferralPanel({
  referralCode,
  directReferrals,
  totalNetwork,
  levels,
}: ReferralPanelProps) {
  const [copied, setCopied] = React.useState<"code" | "link" | null>(null);
  const shareLink =
    referralCode && typeof window !== "undefined"
      ? `${window.location.origin}/register?ref=${referralCode}`
      : "";

  async function copy(value: string, kind: "code" | "link") {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="size-4 text-[var(--color-gold)]" aria-hidden />
          Rujukan
        </CardTitle>
        <CardDescription>
          Bagikan kode rujukan Anda. Hubungan rujukan dicatat permanen di database dan hanya
          dapat diubah melalui proses admin yang teraudit.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
              Kode Anda
            </p>
            <p className="truncate font-mono text-lg font-semibold text-white">
              {referralCode ?? "—"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copy(referralCode ?? "", "code")}
            disabled={!referralCode}
          >
            {copied === "code" ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied === "code" ? "Tersalin" : "Salin kode"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => copy(shareLink, "link")}
            disabled={!referralCode}
          >
            {copied === "link" ? <Check aria-hidden /> : <Share2 aria-hidden />}
            {copied === "link" ? "Tersalin" : "Salin tautan"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
              Rujukan langsung
            </p>
            <p className="mt-1 text-xl font-semibold text-white">{directReferrals}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
              Jaringan tercatat
            </p>
            <p className="mt-1 text-xl font-semibold text-white">{totalNetwork}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
            Struktur komisi per tingkat
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {levels.map((entry) => (
              <li
                key={entry.level}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2 text-sm"
              >
                <span className="text-white/70">Tingkat {entry.level}</span>
                <span className="font-semibold text-[var(--color-neon)]">{entry.rate}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/referral">
            <Share2 aria-hidden />
            Buka halaman rujukan lengkap
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
