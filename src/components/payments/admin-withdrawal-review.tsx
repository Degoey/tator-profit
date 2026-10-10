"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileUp,
  Loader2,
  Package,
  RotateCcw,
  Truck,
} from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { ConfirmDialog, Modal } from "@/components/payments/modal";
import {
  PROOF_ACCEPT,
  PROOF_MAX_BYTES,
  PROOF_MAX_MB,
  WITHDRAWAL_METHODS,
  optionLabel,
} from "@/components/payments/options";
import { DetailItem, RequestAuditList, type RequestAuditEntry } from "@/components/payments/review-detail";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

export interface AdminWithdrawalRow {
  id: string;
  /** Gross amount requested. */
  amount: string;
  /** Platform fee (10% of the gross). */
  fee: string;
  /** Gross minus fee — the amount that must be paid out. */
  netAmount: string;
  currency: string;
  method: string;
  destination: string;
  notes: string | null;
  status: string;
  rejectionReason: string | null;
  reviewNote: string | null;
  userName: string;
  userUsername: string;
  userEmail: string;
  availableAmount: string;
  reservedAmount: string;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
  processedAt: Date | string | null;
  completedAt: Date | string | null;
  /** Audit entries for this single request, newest first. */
  auditHistory: RequestAuditEntry[];
  /** Transfer proof uploaded by an administrator when marking the payout done. */
  proofFileName: string | null;
  proofMimeType: string | null;
  proofSize: number | null;
}

interface ReviewAction {
  value: string;
  label: string;
  tone: "default" | "danger";
  requiresReason: boolean;
  icon: typeof CheckCircle2;
}

const WITHDRAWAL_REVIEW_ACTIONS: ReviewAction[] = [
  { value: "UNDER_REVIEW", label: "Tandai sedang ditinjau", tone: "default", requiresReason: false, icon: RotateCcw },
  { value: "APPROVED", label: "Setujui penarikan", tone: "default", requiresReason: false, icon: CheckCircle2 },
  { value: "PROCESSING", label: "Mulai proses transfer", tone: "default", requiresReason: false, icon: Package },
  { value: "COMPLETED", label: "Tandai selesai", tone: "default", requiresReason: false, icon: Truck },
  { value: "REJECTED", label: "Tolak penarikan", tone: "danger", requiresReason: true, icon: AlertTriangle },
];

interface PendingReview {
  row: AdminWithdrawalRow;
  action: ReviewAction;
}


export function AdminWithdrawalReview({
  rows,
  allowedActions,
}: {
  rows: AdminWithdrawalRow[];
  /** Review actions the signed-in administrator may perform; empty = read only. */
  allowedActions: string[];
}) {
  const [detail, setDetail] = React.useState<AdminWithdrawalRow | null>(null);
  const [pendingReview, setPendingReview] = React.useState<PendingReview | null>(null);
  const [reason, setReason] = React.useState("");
  const [proof, setProof] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const proofInputRef = React.useRef<HTMLInputElement | null>(null);

  /** Resets the confirmation form without touching the notice banner. */
  function resetReviewForm() {
    setPendingReview(null);
    setReason("");
    setProof(null);
    setFileError(null);
    setError(null);
    if (proofInputRef.current) proofInputRef.current.value = "";
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileError(null);
    if (file && file.size > PROOF_MAX_BYTES) {
      setFileError(`Ukuran bukti maksimal ${PROOF_MAX_MB} MB.`);
      setProof(null);
      event.target.value = "";
      return;
    }
    setProof(file);
  }

  const columns: DataTableColumn<AdminWithdrawalRow>[] = [
    {
      key: "createdAt",
      header: "Diajukan",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "user",
      header: "Pengguna",
      sortValue: (row) => row.userUsername,
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.userName}</p>
          <p className="text-[11px] text-white/40">
            @{row.userUsername} · {row.userEmail}
          </p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Nilai",
      sortValue: (row) => Number(row.amount),
      render: (row) => (
        <span className="font-semibold text-[var(--color-neon)]">
          {formatMoney(row.amount, row.currency)}
        </span>
      ),
    },
    {
      key: "method",
      header: "Metode",
      render: (row) => (
        <span className="text-white/60">{optionLabel(WITHDRAWAL_METHODS, row.method)}</span>
      ),
    },
    {
      key: "destination",
      header: "Tujuan",
      render: (row) => <span className="text-white/60">{row.destination}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <PaymentStatusBadge status={row.status} />,
    },
    {
      key: "action",
      header: "Aksi",
      headerClassName: "text-right",
      className: "text-right",
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setDetail(row);
          }}
        >
          <Eye aria-hidden />
          Tinjau
        </Button>
      ),
    },

  ];

  async function submitReview() {
    if (!pendingReview) return;
    setSubmitting(true);
    setError(null);

    try {
      // Marking the payout COMPLETED may carry an optional transfer proof: the
      // route accepts multipart for that step (and coordinates it with the
      // private proof store). Every other action stays a plain JSON body.
      const requestInit: RequestInit =
        pendingReview.action.value === "COMPLETED"
          ? {
              method: "POST",
              body: (() => {
                const body = new FormData();
                body.set("id", pendingReview.row.id);
                body.set("action", pendingReview.action.value);
                body.set("reason", reason.trim());
                if (proof) body.set("proof", proof);
                return body;
              })(),
            }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: pendingReview.row.id,
                action: pendingReview.action.value,
                reason: reason.trim() || undefined,
              }),
            };

      const response = await fetch("/api/admin/withdrawals", requestInit);
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setError(
          payload.message ??
            payload.fieldErrors?.reason ??
            "Aksi tinjauan penarikan tidak dapat diproses.",
        );
        return;
      }

      setNotice(
        `Penarikan ${formatMoney(pendingReview.row.amount, pendingReview.row.currency)} dari ` +
          `@${pendingReview.row.userUsername} → ${pendingReview.action.label}.`,
      );
      setPendingReview(null);
      setDetail(null);
      setReason("");
      setProof(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      window.location.reload();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert variant="success" title="Tindakan tercatat">
          {notice}
        </Alert>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Daftar permintaan penarikan untuk ditinjau"
        searchPlaceholder="Cari pengguna, tujuan, atau status..."
        searchText={(row) =>
          [row.userName, row.userUsername, row.userEmail, row.destination, row.status].join(" ")
        }
        filters={{
          label: "Status",
          options: [
            { value: "PENDING", label: "Menunggu" },
            { value: "UNDER_REVIEW", label: "Sedang ditinjau" },
            { value: "APPROVED", label: "Disetujui" },
            { value: "PROCESSING", label: "Sedang diproses" },
            { value: "COMPLETED", label: "Selesai" },
            { value: "REJECTED", label: "Ditolak" },
          ],

          match: (row, value) => row.status === value,
        }}
        onRowClick={setDetail}
        rowAriaLabel={(row) => `Tinjau penarikan dari @${row.userUsername}`}
        emptyMessage="Tidak ada permintaan penarikan pada filter ini."
      />




      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
          setError(null);
        }}
        title="Tinjau penarikan"
        description={detail ? `Diajukan ${formatPaymentDate(detail.createdAt)}` : undefined}
        size="lg"
        footer={
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDetail(null);
              setError(null);
            }}
          >
            Tutup
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-4">
            {error ? (
              <Alert variant="danger" title="Gagal">
                {error}
              </Alert>
            ) : null}

            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailItem label="Pengguna" value={`${detail.userName} (@${detail.userUsername})`} />
              <DetailItem label="Surel" value={detail.userEmail} />
              <DetailItem
                label="Nilai penarikan"
                value={formatMoney(detail.amount, detail.currency)}
                accent
              />
              <DetailItem
                label="Biaya penarikan (10%)"
                value={formatMoney(detail.fee, detail.currency)}
              />
              <DetailItem
                label="Nominal bersih dibayarkan"
                value={formatMoney(detail.netAmount, detail.currency)}
                accent
              />
              <DetailItem
                label="Metode"
                value={optionLabel(WITHDRAWAL_METHODS, detail.method)}
              />
              <DetailItem label="Tujuan" value={detail.destination} />
              <DetailItem
                label="Saldo tersedia pengguna"
                value={formatMoney(detail.availableAmount, detail.currency)}
              />
              <DetailItem
                label="Saldo tertahan"
                value={formatMoney(detail.reservedAmount, detail.currency)}
              />
              <DetailItem
                label="Status penarikan"
                value={<PaymentStatusBadge status={detail.status} />}
              />
            </dl>

            {detail.proofFileName ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  Bukti transfer (dilampirkan)
                </p>
                <p className="mt-1 text-sm text-white/75">
                  {detail.proofFileName}
                  {detail.proofSize ? ` · ${(detail.proofSize / 1024).toFixed(0)} KB` : ""}
                  {detail.proofMimeType ? ` · ${detail.proofMimeType}` : ""}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <a
                    href={`/api/withdrawals/${detail.id}/proof`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Eye aria-hidden />
                    Buka bukti (privat)
                  </a>
                </Button>
              </div>
            ) : null}

            {detail.notes ? (
              <Alert variant="info" title="Catatan pengguna">
                {detail.notes}
              </Alert>
            ) : null}
            {detail.rejectionReason ? (
              <Alert variant="danger" title="Alasan penolakan">
                {detail.rejectionReason}
              </Alert>
            ) : null}
            {detail.reviewNote ? (
              <Alert variant="info" title="Catatan tinjauan">
                {detail.reviewNote}
              </Alert>
            ) : null}

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Riwayat permintaan ini
              </p>
              <RequestAuditList entries={detail.auditHistory} />
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Tindakan tinjauan
              </p>
              {allowedActions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {WITHDRAWAL_REVIEW_ACTIONS.filter((action) =>
                    allowedActions.includes(action.value),
                  ).map((action) => (
                    <Button
                      key={action.value}
                      type="button"
                      variant={action.tone === "danger" ? "outline" : "default"}
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setReason("");
                        setProof(null);
                        setFileError(null);
                        if (proofInputRef.current) proofInputRef.current.value = "";
                        setPendingReview({ row: detail, action });
                      }}
                    >
                      <action.icon aria-hidden />
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : (
                <Alert variant="warning" title="Hanya baca">
                  Peran administrator Anda tidak memiliki izin meninjau penarikan. Hubungi
                  SUPER_ADMIN untuk mendapatkan akses FINANCE.
                </Alert>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingReview !== null}
        title={pendingReview?.action.label ?? "Konfirmasi tindakan"}
        description={
          pendingReview
            ? `Penarikan ${formatMoney(pendingReview.row.amount, pendingReview.row.currency)} untuk @${pendingReview.row.userUsername}. Nominal bersih dibayarkan ${formatMoney(pendingReview.row.netAmount, pendingReview.row.currency)} (biaya ${formatMoney(pendingReview.row.fee, pendingReview.row.currency)}). Tindakan ini tercatat permanen pada jejak audit.`
            : ""
        }
        confirmLabel="Konfirmasi"
        tone={pendingReview?.action.tone ?? "default"}
        pending={submitting}
        onCancel={() => {
          if (submitting) return;
          resetReviewForm();
        }}
        onConfirm={() => {
          if (pendingReview?.action.requiresReason && reason.trim().length < 3) {
            setError("Alasan wajib diisi (minimal 3 karakter) untuk tindakan ini.");
            return;
          }
          void submitReview();
        }}
      >
        {error ? (
          <Alert variant="danger" title="Periksa kembali">
            {error}
          </Alert>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="withdrawal-review-reason"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
          >
            {pendingReview?.action.requiresReason ? "Alasan (wajib)" : "Catatan (opsional)"}
          </label>
          <Input
            id="withdrawal-review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder={
              pendingReview?.action.requiresReason
                ? "Contoh: tujuan penarikan bukan atas nama pemilik akun."
                : "Catatan tambahan untuk jejak audit."
            }
            disabled={submitting}
          />
          <p className="text-xs text-white/40">
            {pendingReview?.action.requiresReason
              ? "Alasan disimpan pada catatan penolakan dan dapat dilihat pengguna."
              : "Catatan opsional yang tersimpan pada riwayat tinjauan."}
          </p>
        </div>

        {pendingReview?.action.value === "COMPLETED" ? (
          <div className="space-y-2">
            <label
              htmlFor="withdrawal-review-proof"
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
            >
              <FileUp className="size-3.5" aria-hidden />
              Bukti transfer (opsional)
            </label>
            <Input
              id="withdrawal-review-proof"
              ref={proofInputRef}
              type="file"
              accept={PROOF_ACCEPT}
              onChange={handleFileChange}
              disabled={submitting}
              className="h-auto py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <p className="text-xs text-white/40">
              {fileError ??
                `PNG, JPG atau PDF, maksimal ${PROOF_MAX_MB} MB. Berkas disimpan privat dan dapat diunduh pengguna pada detail penarikan.`}
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-white/50">
          {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          <Badge variant="muted">Audit</Badge>
          <span>Setiap tindakan tinjauan dicatat dengan aktor dan waktu.</span>
        </div>
      </ConfirmDialog>
    </div>
  );
}
