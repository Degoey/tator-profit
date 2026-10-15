"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog, Modal } from "@/components/payments/modal";
import { CopyButton } from "@/components/owner/copy-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Tindakan keamanan pemilik yang sensitif: membuat ulang kode pemulihan,
 * mencabut sesi lain, dan mematikan 2FA. Ketiganya wajib disertai kode yang sah —
 * jadi sesi yang sudah dibajak tetap tidak dapat mengubah pengaturan 2FA tanpa
 * memegang perangkat autentikator.
 */
type Action = "recovery" | "sessions" | "disable";

const COPY: Record<Action, { title: string; description: string; confirm: string }> = {
  recovery: {
    title: "Buat ulang kode pemulihan?",
    description:
      "Seluruh kode pemulihan lama langsung tidak berlaku. Kode baru ditampilkan sekali setelah tindakan ini.",
    confirm: "Buat ulang",
  },
  sessions: {
    title: "Cabut semua sesi lain?",
    description:
      "Setiap sesi Konsol Pemilik selain sesi ini akan dihentikan. Perangkat lain harus masuk dan memverifikasi 2FA lagi.",
    confirm: "Cabut sesi lain",
  },
  disable: {
    title: "Matikan 2FA?",
    description:
      "Tanpa 2FA, konsol pemilik hanya dijaga kata sandi. Seluruh sesi pemilik kehilangan status verifikasi, dan pendaftaran 2FA harus diulang.",
    confirm: "Matikan 2FA",
  },
};

export function OwnerSecurityActions({ remainingRecoveryCodes }: { remainingRecoveryCodes: number }) {
  const router = useRouter();
  const [action, setAction] = React.useState<Action | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );
  const [newRecoveryCodes, setNewRecoveryCodes] = React.useState<string[]>([]);

  function open(next: Action) {
    setAction(next);
    setCode("");
    setUseRecovery(false);
    setConfirming(false);
    setFeedback(null);
  }

  function close() {
    if (pending) return;
    setAction(null);
    setConfirming(false);
  }

  async function submit() {
    if (!action) return;
    setPending(true);
    try {
      const endpoint =
        action === "recovery"
          ? "/api/owner/2fa/recovery"
          : action === "sessions"
            ? "/api/owner/sessions/revoke"
            : "/api/owner/2fa/disable";

      const body = useRecovery ? { recoveryCode: code.trim() } : { code: code.trim() };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: { recoveryCodes?: string[]; revokedCount?: number } }
        | null;

      if (!response.ok || !payload?.ok) {
        setConfirming(false);
        setPending(false);
        setFeedback({ tone: "danger", text: payload?.message ?? "Tindakan gagal." });
        return;
      }

      setPending(false);
      setConfirming(false);
      setAction(null);

      if (action === "recovery") {
        setNewRecoveryCodes(payload.data?.recoveryCodes ?? []);
        setFeedback({ tone: "success", text: "Kode pemulihan baru sudah dibuat. Simpan sekarang." });
      } else if (action === "sessions") {
        setFeedback({
          tone: "success",
          text: `Sesi lain dicabut: ${payload.data?.revokedCount ?? 0}.`,
        });
      } else {
        setFeedback({ tone: "success", text: "2FA dimatikan. Daftarkan ulang sebelum memakai konsol." });
      }
      router.refresh();
    } catch {
      setPending(false);
      setConfirming(false);
      setFeedback({ tone: "danger", text: "Tidak dapat menghubungi server." });
    }
  }

  return (
    <div className="space-y-4">
      {feedback ? (
        <Alert variant={feedback.tone} title={feedback.tone === "success" ? "Selesai" : "Gagal"}>
          {feedback.text}
        </Alert>
      ) : null}

      {newRecoveryCodes.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Kode pemulihan baru (ditampilkan sekali)
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {newRecoveryCodes.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-white"
              >
                {item}
              </li>
            ))}
          </ul>
          <CopyButton value={newRecoveryCodes.join("\n")} label="Salin semua kode" />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => open("recovery")}>
          Buat ulang kode pemulihan ({remainingRecoveryCodes} tersisa)
        </Button>
        <Button type="button" variant="outline" onClick={() => open("sessions")}>
          Cabut semua sesi lain
        </Button>
        <Button type="button" variant="gold" onClick={() => open("disable")}>
          Matikan 2FA
        </Button>
      </div>

      <Modal
        open={Boolean(action) && !confirming}
        onClose={close}
        title={action ? COPY[action].title : ""}
        description="Masukkan kode 2FA (atau satu kode pemulihan) untuk melanjutkan."
        locked={pending}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending || code.trim().length === 0}
            >
              Lanjut ke konfirmasi
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <label
            htmlFor="owner-security-code"
            className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
          >
            {useRecovery ? "Kode pemulihan" : "Kode 2FA"}
          </label>
          <Input
            id="owner-security-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode={useRecovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            maxLength={24}
            placeholder={useRecovery ? "XXXX-XXXX-XXXX" : "123456"}
          />
          <button
            type="button"
            className="text-xs text-[var(--color-neon)] underline-offset-4 hover:underline"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode("");
            }}
          >
            {useRecovery ? "Pakai kode autentikator" : "Pakai kode pemulihan"}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(action) && confirming}
        title={action ? COPY[action].title : ""}
        description={action ? COPY[action].description : ""}
        confirmLabel={action ? COPY[action].confirm : "Lanjutkan"}
        tone={action === "disable" ? "danger" : "default"}
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      />
    </div>
  );
}
