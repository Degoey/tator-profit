import { statusLabel } from "@/lib/status-labels";

/**
 * Teks notifikasi komisi rujukan untuk member.
 *
 * Satu komisi diumumkan pada dua saat: ketika barisnya dicatat (MENUNGGU) dan
 * ketika administrator menuntaskannya (dibayar / ditolak / dibatalkan). Fungsi di
 * sini hanya menyusun judul, isi, dan metadata — tanpa menyentuh database —
 * sedangkan baris `Notification`-nya ditulis `referral-service` dengan klien
 * transaksi yang sama seperti perubahan statusnya. Karena itu tidak mungkin ada
 * pesan untuk komisi yang tidak tersimpan, dan transaksi yang di-rollback tidak
 * meninggalkan pesan apa pun.
 *
 * `metadata.href` selalu menunjuk halaman `/referral`, daftar komisi milik member
 * sendiri, dan tidak pernah dibangun dari input pengguna. `metadata.commissionId`
 * memungkinkan tampilan berikutnya menyorot baris komisi yang dimaksud.
 */

/** Halaman tujuan semua notifikasi rujukan. */
export const REFERRAL_NOTIFICATION_HREF = "/referral";

/** Metadata notifikasi: JSON datar berisi teks saja, tanpa objek bersarang. */
export type ReferralNotificationMetadata = Record<string, string | null>;

export type ReferralNotificationDraft = {
  title: string;
  body: string;
  metadata: ReferralNotificationMetadata;
};

/**
 * Aksi penuntasan komisi yang layak diberitahukan ke member. APPROVE sengaja
 * tanpa pesan, sama seperti siklus imbalan mingguan: persetujuan belum memindahkan
 * uang, jadi member hanya diberi tahu saat komisi tercatat dan saat dituntaskan.
 */
export type ReferralNotificationAction = "PAY" | "REJECT" | "VOID";

/** "Komisi rujukan tingkat 2 sebesar USDT 2.00" */
function commissionSubject(level: number, currency: string, amount: string): string {
  return `Komisi rujukan tingkat ${level} sebesar ${currency} ${amount}`;
}

/** Bagian metadata yang sama untuk semua notifikasi rujukan. */
function baseMetadata(input: {
  commissionId: string;
  level: number;
  amount: string;
  currency: string;
  sourceUserId: string;
}): ReferralNotificationMetadata {
  return {
    commissionId: input.commissionId,
    level: `${input.level}`,
    amount: input.amount,
    currency: input.currency,
    sourceUserId: input.sourceUserId,
    href: REFERRAL_NOTIFICATION_HREF,
  };
}

/**
 * Diumumkan begitu komisi dicatat sebagai MENUNGGU. Nilai `amount` dan
 * `currency` sudah diformat pemanggil dengan dua desimal, sehingga angka yang
 * dibaca member sama persis dengan angka yang tersimpan di baris komisi.
 */
export function referralCommissionRecordedNotification(input: {
  commissionId: string;
  level: number;
  amount: string;
  currency: string;
  sourceUserId: string;
  sourceReference: string | null;
}): ReferralNotificationDraft {
  return {
    title: `Komisi rujukan tercatat: tingkat ${input.level}`,
    body:
      `${commissionSubject(input.level, input.currency, input.amount)} dicatat berstatus ` +
      `${statusLabel("PENDING").toLowerCase()}. Komisi masuk ke saldo tersedia Anda setelah ` +
      `disetujui dan dibayar administrator.`,
    metadata: {
      ...baseMetadata(input),
      status: "PENDING",
      sourceReference: input.sourceReference,
      payoutReference: null,
      reason: null,
    },
  };
}

/**
 * Diumumkan saat komisi dituntaskan administrator. `status` adalah status hasil
 * yang benar-benar tersimpan (PAID / REJECTED / VOID), bukan tebakan dari aksi,
 * dan alasan penolakan/pembatalan ikut ditampilkan seperti yang diminta sistem.
 */
export function referralCommissionSettledNotification(input: {
  action: ReferralNotificationAction;
  commissionId: string;
  level: number;
  amount: string;
  currency: string;
  status: string;
  sourceUserId: string;
  payoutReference?: string | null;
  reason?: string | null;
}): ReferralNotificationDraft {
  const subject = commissionSubject(input.level, input.currency, input.amount);
  const reason = input.reason?.trim() ? input.reason.trim() : "tidak disebutkan";

  const body =
    input.action === "PAY"
      ? `${subject} sudah dibayar dan masuk ke saldo tersedia Anda.`
      : input.action === "REJECT"
        ? `${subject} ditolak. Alasan: ${reason}`
        : `${subject} dibatalkan. Alasan: ${reason}`;

  const title =
    input.action === "PAY"
      ? `Komisi rujukan dibayar: tingkat ${input.level}`
      : input.action === "REJECT"
        ? `Komisi rujukan ditolak: tingkat ${input.level}`
        : `Komisi rujukan dibatalkan: tingkat ${input.level}`;

  return {
    title,
    body,
    metadata: {
      ...baseMetadata(input),
      status: input.status,
      sourceReference: null,
      payoutReference: input.payoutReference ?? null,
      reason: input.action === "PAY" ? null : reason,
    },
  };
}
