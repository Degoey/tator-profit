"use client";

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  PlayCircle,
  RotateCcw,
  Wallet,
} from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { ConfirmDialog, Modal } from "@/components/payments/modal";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { DetailItem, RequestAuditList, type RequestAuditEntry } from "@/components/payments/review-detail";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

export interface AdminMembershipRow {
  id: string;
  userName: string;
  userUsername: string;
  userEmail: string;
  programName: string;
  programCode: string;
  tierCode: string;
  tierName: string;
  /** Weeks promised to this member at join time (contract snapshot). */
  cycleWeeks: number;
  weeklyRewardRate: string;
  maxCycleRewardRate: string;
  joinAmount: string;
  currency: string;
  fundsConfirmedAmount: string;
  fundsConfirmedAt: Date | string | null;
  status: string;
  cycleNumber: number;
  weeksCompleted: number;
  referralCodeUsed: string | null;
  joinedAt: Date | string;
  activatedAt: Date | string | null;
  completedAt: Date | string | null;
  suspendedAt: Date | string | null;
  cancelledAt: Date | string | null;
  notes: string | null;
  latestDepositStatus: string | null;
  latestDepositAmount: string | null;
  auditHistory: RequestAuditEntry[];
}

/**
 * Aksi siklus keanggotaan.
 *
 * `activate` mengonfirmasi dana yang sudah diterima di luar platform dan memulai
 * siklus; `generate` mencatat imbalan periode berjalan (rute imbalan); sisanya
 * memindahkan status. `requiresReason` menandai aksi yang wajib beralasan karena
 * menghentikan hak imbalan anggota.
 */
interface MembershipAction {
  value: string;
  label: string;
  tone: "default" | "danger";
  requiresReason: boolean;
  /** Rute yang melayani aksi ini: siklus keanggotaan atau mesin imbalan. */
  endpoint: "/api/admin/programs" | "/api/admin/rewards";
  /** Aksi pemberian dana/imbalan hanya masuk akal pada status tertentu. */
  visibleWhen: (row: AdminMembershipRow) => boolean;
  icon: typeof CheckCircle2;
  hint: string;
}

const MEMBERSHIP_ACTIONS: MembershipAction[] = [
  {
    value: "activate",
    label: "Aktifkan keanggotaan",
    tone: "default",
    requiresReason: false,
    endpoint: "/api/admin/programs",
    visibleWhen: (row) => row.status === "PENDING",
    icon: CheckCircle2,
    hint: "Dana sudah diterima di luar platform; keanggotaan aktif dan imbalan periode pertama dicatat.",
  },
  {
    value: "generate",
    label: "Catat imbalan periode berjalan",
    tone: "default",
    requiresReason: false,
    endpoint: "/api/admin/rewards",
    visibleWhen: (row) => row.status === "ACTIVE",
    icon: Wallet,
    hint: "Mencatat imbalan satu periode berjalan; saldo baru berpindah setelah disetujui dan dibayarkan.",
  },
  {
    value: "suspend",
    label: "Tunda (tangguhkan)",
    tone: "default",
    requiresReason: true,
    endpoint: "/api/admin/programs",
    visibleWhen: (row) => row.status === "ACTIVE",
    icon: Clock,
    hint: "Status SUSPENDED: hak imbalan berhenti sampai dilanjutkan, dana tetap tercatat.",
  },
  {
    value: "resume",
    label: "Lanjutkan",
    tone: "default",
    requiresReason: false,
    endpoint: "/api/admin/programs",
    visibleWhen: (row) => row.status === "SUSPENDED",
    icon: PlayCircle,
    hint: "Mengembalikan keanggotaan ke ACTIVE tanpa mengubah jumlah periode yang sudah selesai.",
  },
  {
    value: "complete",
    label: "Selesaikan",
    tone: "default",
    requiresReason: false,
    endpoint: "/api/admin/programs",
    visibleWhen: (row) => row.status === "ACTIVE" || row.status === "SUSPENDED",
    icon: RotateCcw,
    hint: "Menutup siklus: keanggotaan berstatus COMPLETED dan tidak lagi menerima imbalan baru.",
  },
  {
    value: "cancel",
    label: "Batalkan & kembalikan dana",
    tone: "danger",
    requiresReason: true,
    endpoint: "/api/admin/programs",
    visibleWhen: (row) =>
      row.status === "PENDING" || row.status === "ACTIVE" || row.status === "SUSPENDED",
    icon: Ban,
    hint: "Pembatalan bersifat permanen pada baris ini; pengembalian dana dicatat sebagai entri ADJUSTMENT terpisah.",
  },
];

interface PendingAction {
  row: AdminMembershipRow;
  action: MembershipAction;
}

export function AdminMembershipReview({
  rows,
  allowedActions,
}: {
  rows: AdminMembershipRow[];
  /** Aksi yang boleh dijalankan administrator ini; kosong berarti hanya baca. */
  allowedActions: string[];
}) {
  const [detail, setDetail] = React.useState<AdminMembershipRow | null>(null);
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null);
  const [reason, setReason] = React.useState("");
  const [confirmedAmount, setConfirmedAmount] = React.useState("");
  const [period, setPeriod] = React.useState("");
  const [refundFunds, setRefundFunds] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const canDecide = allowedActions.length > 0;

  const columns: DataTableColumn<AdminMembershipRow>[] = [
    {
      key: "joinedAt",
      header: "Diajukan",
      sortValue: (row) => new Date(row.joinedAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.joinedAt)}</span>,
    },
    {
      key: "user",
      header: "Anggota",
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
      key: "program",
      header: "Paket",
      render: (row) => (
        <div>
          <p className="text-white">
            {row.tierCode} · {row.tierName}
          </p>
          <p className="text-[11px] text-white/40">{row.programName}</p>
        </div>
      ),
    },
    {
      key: "target",
      header: "Nilai & tingkat",
      sortValue: (row) => Number(row.joinAmount),
      render: (row) => (
        <div>
          <p className="font-semibold text-[var(--color-gold)]">
            {formatMoney(row.joinAmount, row.currency)}
          </p>
          <p className="text-[11px] text-white/40">
            {row.weeklyRewardRate}%/minggu · {row.cycleWeeks} minggu
          </p>
        </div>
      ),
    },
    {
      key: "funds",
      header: "Dana tercatat",
      render: (row) => (
        <div>
          <p className="text-white">{formatMoney(row.fundsConfirmedAmount, row.currency)}</p>
          <p className="text-[11px] text-white/40">
            {row.fundsConfirmedAt ? formatPaymentDate(row.fundsConfirmedAt) : "belum dikonfirmasi"}
          </p>
        </div>
      ),
    },
    {
      key: "progress",
      header: "Progres",
      sortValue: (row) => row.weeksCompleted,
      render: (row) => (
        <span className="text-white/70">
          {row.weeksCompleted}/{row.cycleWeeks} · siklus {row.cycleNumber}
        </span>
      ),
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
            setNotice(null);
            setDetail(row);
          }}
        >
          <Eye aria-hidden />
          Tinjau
        </Button>
      ),
    },
  ];

  async function submitAction() {
    if (!pendingAction) return;
    const { row, action } = pendingAction;
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> =
      action.endpoint === "/api/admin/rewards"
        ? {
            action: action.value,
            userProgramId: row.id,
            ...(period.trim() ? { period: Number(period.trim()) } : {}),
            reason: reason.trim() || undefined,
          }
        : {
            action: action.value,
            userProgramId: row.id,
            reason: reason.trim() || undefined,
            ...(action.value === "activate" && confirmedAmount.trim()
              ? { confirmedAmount: confirmedAmount.trim() }
              : {}),
            ...(action.value === "cancel" ? { refundFunds } : {}),
          };

    try {
      const response = await fetch(action.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setError(
          payload.message ??
            Object.values(payload.fieldErrors ?? {})[0] ??
            "Aksi keanggotaan tidak dapat diproses.",
        );
        return;
      }

      setNotice(
        `${action.label} untuk @${row.userUsername} (${row.tierCode}) tercatat. ` +
          "Imbalan hanya berpindah setelah disetujui dan dibayarkan.",
      );
      setPendingAction(null);
      setDetail(null);
      resetForm();
      window.location.reload();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setReason("");
    setConfirmedAmount("");
    setPeriod("");
    setRefundFunds(false);
    setError(null);
  }

  const availableActions = detail
    ? MEMBERSHIP_ACTIONS.filter(
        (action) => allowedActions.includes(action.value) && action.visibleWhen(detail),
      )
    : [];

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
        caption="Keanggotaan program: aktifkan, tunda, lanjutkan, selesaikan, atau batalkan"
        searchPlaceholder="Cari anggota, program, atau status..."
        searchText={(row) =>
          [
            row.userName,
            row.userUsername,
            row.userEmail,
            row.programName,
            row.tierCode,
            row.status,
          ].join(" ")
        }
        filters={{
          label: "Status",
          options: [
            { value: "PENDING", label: "Menunggu" },
            { value: "ACTIVE", label: "Aktif" },
            { value: "SUSPENDED", label: "Ditangguhkan" },
            { value: "COMPLETED", label: "Selesai" },
            { value: "CANCELLED", label: "Dibatalkan" },
          ],
          match: (row, value) => row.status === value,
        }}
        onRowClick={(row) => {
          setNotice(null);
          setDetail(row);
        }}
        rowAriaLabel={(row) => `Tinjau keanggotaan @${row.userUsername}`}
        emptyMessage="Belum ada keanggotaan pada filter ini."
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
          resetForm();
        }}
        title="Tinjau keanggotaan"
        description={detail ? `Diajukan ${formatPaymentDate(detail.joinedAt)}` : undefined}
        size="lg"
        footer={
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDetail(null);
              resetForm();
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
              <DetailItem label="Anggota" value={`${detail.userName} (@${detail.userUsername})`} />
              <DetailItem label="Surel" value={detail.userEmail} />
              <DetailItem
                label="Paket"
                value={`${detail.tierCode} · ${detail.tierName} (${detail.programName})`}
                accent
              />
              <DetailItem
                label="Nilai bergabung"
                value={formatMoney(detail.joinAmount, detail.currency)}
              />
              <DetailItem
                label="Dana tercatat"
                value={formatMoney(detail.fundsConfirmedAmount, detail.currency)}
              />
              <DetailItem
                label="Dikonfirmasi pada"
                value={
                  detail.fundsConfirmedAt ? formatPaymentDate(detail.fundsConfirmedAt) : "Belum"
                }
              />
              <DetailItem
                label="Tingkat imbalan (kontrak)"
                value={`${detail.weeklyRewardRate}%/minggu · maksimum ${detail.maxCycleRewardRate}% per siklus`}
              />
              <DetailItem
                label="Progres"
                value={`Minggu ${detail.weeksCompleted} dari ${detail.cycleWeeks} · siklus ${detail.cycleNumber}`}
              />
              <DetailItem
                label="Status keanggotaan"
                value={<PaymentStatusBadge status={detail.status} />}
              />
              <DetailItem
                label="Setoran terakhir"
                value={
                  detail.latestDepositStatus
                    ? `${detail.latestDepositStatus}${
                        detail.latestDepositAmount
                          ? ` · ${formatMoney(detail.latestDepositAmount, detail.currency)}`
                          : ""
                      }`
                    : "Belum ada setoran"
                }
              />
              <DetailItem label="Kode rujukan dipakai" value={detail.referralCodeUsed ?? "—"} />
              <DetailItem
                label="Aktif pada"
                value={detail.activatedAt ? formatPaymentDate(detail.activatedAt) : "Belum aktif"}
              />
              {detail.suspendedAt ? (
                <DetailItem
                  label="Ditangguhkan pada"
                  value={formatPaymentDate(detail.suspendedAt)}
                />
              ) : null}
              {detail.completedAt ? (
                <DetailItem label="Selesai pada" value={formatPaymentDate(detail.completedAt)} />
              ) : null}
              {detail.cancelledAt ? (
                <DetailItem
                  label="Dibatalkan pada"
                  value={formatPaymentDate(detail.cancelledAt)}
                />
              ) : null}
            </dl>

            {detail.notes ? (
              <Alert variant="info" title="Catatan keanggotaan">
                {detail.notes}
              </Alert>
            ) : null}

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Riwayat keanggotaan ini
              </p>
              <RequestAuditList entries={detail.auditHistory} />
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Tindakan siklus keanggotaan
              </p>
              {!canDecide ? (
                <Alert variant="warning" title="Hanya baca">
                  Peran administrator Anda tidak memiliki izin mengelola keanggotaan
                  (<code>manageFinance</code>). Hubungi pemilik untuk mendapatkan peran FINANCE
                  atau SUPER_ADMIN.
                </Alert>
              ) : availableActions.length === 0 ? (
                <Alert variant="info" title="Tidak ada tindakan untuk status ini">
                  Keanggotaan berstatus {detail.status} tidak dapat dipindahkan lagi. Riwayatnya
                  tetap tersimpan dan tidak dapat dihapus.
                </Alert>
              ) : (
                <div className="space-y-2">
                  {availableActions.map((action) => (
                    <div key={action.value} className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant={action.tone === "danger" ? "outline" : "default"}
                        size="sm"
                        onClick={() => {
                          resetForm();
                          setPendingAction({ row: detail, action });
                        }}
                      >
                        <action.icon aria-hidden />
                        {action.label}
                      </Button>
                      <span className="text-xs text-white/45">{action.hint}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.action.label ?? "Konfirmasi tindakan"}
        description={
          pendingAction
            ? `Keanggotaan ${pendingAction.row.tierCode} milik @${pendingAction.row.userUsername} (${pendingAction.row.status}). Tindakan ini tercatat permanen di jejak audit.`
            : ""
        }
        confirmLabel="Konfirmasi"
        tone={pendingAction?.action.tone ?? "default"}
        pending={submitting}
        onCancel={() => {
          if (submitting) return;
          setPendingAction(null);
          resetForm();
        }}
        onConfirm={() => {
          if (pendingAction?.action.requiresReason && reason.trim().length < 3) {
            setError("Alasan wajib diisi (minimal 3 karakter) untuk tindakan ini.");
            return;
          }
          void submitAction();
        }}
      >
        {error ? (
          <Alert variant="danger" title="Periksa kembali">
            {error}
          </Alert>
        ) : null}

        {pendingAction?.action.value === "activate" ? (
          <div className="space-y-2">
            <label
              htmlFor="membership-confirmed-amount"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
            >
              Jumlah dana dikonfirmasi (opsional)
            </label>
            <Input
              id="membership-confirmed-amount"
              value={confirmedAmount}
              onChange={(event) => setConfirmedAmount(event.target.value)}
              inputMode="decimal"
              placeholder={pendingAction.row.joinAmount}
              disabled={submitting}
            />
            <p className="text-xs text-white/40">
              Kosongkan bila jumlahnya sama dengan nilai paket (
              {formatMoney(pendingAction.row.joinAmount, pendingAction.row.currency)}). Dana program
              dicatat terpisah dari saldo imbalan.
            </p>
          </div>
        ) : null}

        {pendingAction?.action.value === "generate" ? (
          <div className="space-y-2">
            <label
              htmlFor="membership-generate-period"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
            >
              Periode ke- (opsional)
            </label>
            <Input
              id="membership-generate-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              inputMode="numeric"
              placeholder="1"
              disabled={submitting}
            />
            <p className="text-xs text-white/40">
              Kosongkan untuk periode berjalan. Periode yang sudah tercatat tidak digandakan, jadi
              aksi ini aman diulang.
            </p>
          </div>
        ) : null}

        {pendingAction?.action.value === "cancel" ? (
          <label className="flex items-start gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-neon)]"
              checked={refundFunds}
              onChange={(event) => setRefundFunds(event.target.checked)}
              disabled={submitting}
            />
            <span>
              Kembalikan dana program yang tercatat
              {Number(pendingAction.row.fundsConfirmedAmount) > 0
                ? ` (${formatMoney(pendingAction.row.fundsConfirmedAmount, pendingAction.row.currency)})`
                : ""}
              . Pengembalian dicatat sebagai entri penyesuaian, bukan penghapusan riwayat.
            </span>
          </label>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="membership-action-reason"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
          >
            {pendingAction?.action.requiresReason ? "Alasan (wajib)" : "Catatan (opsional)"}
          </label>
          <Input
            id="membership-action-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder={
              pendingAction?.action.requiresReason
                ? "Contoh: pembayaran anggota belum terverifikasi."
                : "Catatan tambahan untuk jejak audit."
            }
            disabled={submitting}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-white/50">
          {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          <Badge variant="muted">Audit</Badge>
          <span>Setiap tindakan dicatat dengan aktor, waktu, dan snapshot sebelum/sesudah.</span>
        </div>
      </ConfirmDialog>

      {canDecide ? null : (
        <Alert variant="warning" title="Peran Anda hanya membaca">
          <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
          Antrean keanggotaan dapat dibaca seluruh peran admin, tetapi mengaktifkan, menunda,
          menyelesaikan, atau membatalkannya memerlukan <code>manageFinance</code>.
        </Alert>
      )}
    </div>
  );
}