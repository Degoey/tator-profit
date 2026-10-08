"use client";

import { Check, Copy, Link2, Share2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface ReferralCodeCardProps {
  referralCode: string | null;
  /**
   * Absolute origin used to build the share link. Provided by the server so the
   * rendered link is complete on the first paint (no `window` needed) and stays
   * identical between server and client render.
   */
  origin: string;
  /** Registration path the referral code is attached to. */
  registerPath?: string;
}

type CopiedKind = "code" | "link" | null;

export function buildReferralLink(
  origin: string,
  referralCode: string,
  registerPath = "/register",
): string {
  if (!referralCode) return "";
  const base = origin ? origin.replace(/\/+$/, "") : "";
  return `${base}${registerPath}?ref=${encodeURIComponent(referralCode)}`;
}

export function ReferralCodeCard({
  referralCode,
  origin,
  registerPath = "/register",
}: ReferralCodeCardProps) {
  const [copied, setCopied] = React.useState<CopiedKind>(null);
  const [shareNote, setShareNote] = React.useState<string | null>(null);
  const timers = React.useRef<number[]>([]);

  const shareLink = referralCode ? buildReferralLink(origin, referralCode, registerPath) : "";
  const shareText = referralCode
    ? `Gabung ke Tatorprofit dengan kode rujukan ${referralCode}.`
    : "";

  React.useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    },
    [],
  );

  function flash(kind: CopiedKind) {
    setCopied(kind);
    timers.current.push(window.setTimeout(() => setCopied(null), 2000));
  }

  async function copy(value: string, kind: "code" | "link") {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setShareNote(null);
      flash(kind);
    } catch {
      setCopied(null);
      setShareNote("Perangkat ini tidak mengizinkan penyalinan otomatis. Salin nilainya secara manual.");
    }
  }

  async function share() {
    if (!referralCode) return;
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      setShareNote("Perangkat ini tidak mendukung tombol bagikan. Gunakan Salin tautan.");
      return;
    }
    try {
      await navigator.share({ title: "Tatorprofit", text: shareText, url: shareLink });
      setShareNote(null);
    } catch {
      // The user dismissed the share sheet; nothing to report.
      setShareNote(null);
    }
  }

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="size-4 text-[var(--color-gold)]" aria-hidden />
          Kode rujukan Anda
        </CardTitle>
        <CardDescription>
          Bagikan kode atau tautan di bawah ini. Hubungan rujukan dicatat satu kali saat
          pendaftaran dan tidak dapat diubah sendiri oleh pengguna.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <label
              htmlFor="referral-code-value"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40"
            >
              Kode rujukan
            </label>
            <input
              id="referral-code-value"
              readOnly
              value={referralCode ?? ""}
              placeholder="Belum tersedia"
              aria-label="Kode rujukan Anda"
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-base font-semibold tracking-wide text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/50"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => copy(referralCode ?? "", "code")}
              disabled={!referralCode}
            >
              {copied === "code" ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied === "code" ? "Kode tersalin" : "Salin kode"}
            </Button>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <label
              htmlFor="referral-link-value"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40"
            >
              Tautan pendaftaran
            </label>
            <input
              id="referral-link-value"
              readOnly
              value={shareLink}
              placeholder="Belum tersedia"
              aria-label="Tautan pendaftaran dengan kode rujukan Anda"
              className="mt-2 w-full truncate rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/50"
            />
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => copy(shareLink, "link")}
                disabled={!referralCode}
              >
                {copied === "link" ? <Check aria-hidden /> : <Link2 aria-hidden />}
                {copied === "link" ? "Tautan tersalin" : "Salin tautan"}
              </Button>
              <Button
                type="button"
                variant="gold"
                size="sm"
                className="flex-1"
                onClick={share}
                disabled={!referralCode}
              >
                <Share2 aria-hidden />
                Bagikan
              </Button>
            </div>
          </div>
        </div>

        {!referralCode ? (
          <p role="status" className="text-sm text-white/60">
            Kode rujukan belum tersedia untuk akun ini. Hubungi admin bila kode tidak muncul
            setelah beberapa menit.
          </p>
        ) : null}

        {shareNote ? (
          <p role="status" className="text-sm text-[var(--color-gold)]">
            {shareNote}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
