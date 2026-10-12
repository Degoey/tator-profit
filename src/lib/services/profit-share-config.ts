import { Prisma, type ProfitSharePolicyStatus } from "@prisma/client";

import { RATE_SCALE } from "@/lib/money";

/**
 * Validasi kebijakan bagi hasil — murni, tanpa database.
 *
 * Kebijakan bagi hasil MENUNGGU PERSETUJUAN PEMILIK. Tidak ada satu persen pun
 * yang ditetapkan di kode ini; berkas ini hanya memeriksa kelengkapan dan
 * kewajaran nilai yang nanti dimasukkan pemilik.
 */

export interface ProfitSharePolicyInput {
  status: ProfitSharePolicyStatus;
  /** Bagian untuk anggota sebagai pecahan (0.5000 = 50%). */
  memberShareRate: Prisma.Decimal | null;
  reserveRate: Prisma.Decimal | null;
  managementFeeRate: Prisma.Decimal | null;
  lossHandling: string | null;
  approvedByUserId?: string | null;
  approvedAt?: Date | null;
}

/** Kebijakan bawaan: belum disetujui, tanpa angka apa pun. */
export const PENDING_APPROVAL_POLICY: ProfitSharePolicyInput = {
  status: "PENDING_APPROVAL",
  memberShareRate: null,
  reserveRate: null,
  managementFeeRate: null,
  lossHandling: null,
  approvedByUserId: null,
  approvedAt: null,
};

/** Pilihan penanganan periode rugi; pemilik memilih salah satunya. */
export const LOSS_HANDLING_OPTIONS = [
  "HOLD",
  "CARRY_FORWARD",
  "ABSORB_BY_COMPANY",
] as const;

export type LossHandlingOption = (typeof LOSS_HANDLING_OPTIONS)[number];

export const LOSS_HANDLING_LABELS: Record<string, string> = {
  HOLD: "Tahan pembagian sampai periode berikutnya",
  CARRY_FORWARD: "Bawa kerugian ke periode berikutnya",
  ABSORB_BY_COMPANY: "Ditanggung perusahaan, tidak mengurangi hak anggota",
};

export function lossHandlingLabel(value: string | null): string {
  if (!value) return "Belum ditetapkan pemilik";
  return LOSS_HANDLING_LABELS[value] ?? value;
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
}

/** Rasio wajib berupa pecahan 0..1 dengan maksimal empat desimal. */
function checkRate(value: Prisma.Decimal | null, label: string, errors: string[]): void {
  if (value === null) {
    errors.push(`${label} belum ditetapkan.`);
    return;
  }
  if (!value.isFinite() || value.isNegative() || value.gt(1)) {
    errors.push(`${label} harus bernilai antara 0 dan 1.`);
    return;
  }
  if (value.decimalPlaces() > 4) {
    errors.push(`${label} maksimal empat desimal.`);
  }
}

/**
 * Memeriksa kebijakan. Kebijakan berstatus APPROVED wajib punya seluruh angka,
 * penanganan kerugian, dan bukti persetujuan (siapa + kapan). Kebijakan yang belum
 * disetujui selalu `valid: false` — itulah yang membuat mesin alokasi gagal-tertutup.
 */
export function validateProfitSharePolicy(
  policy: ProfitSharePolicyInput,
): PolicyValidationResult {
  const errors: string[] = [];

  if (policy.status !== "APPROVED") {
    errors.push(
      `Kebijakan bagi hasil berstatus ${policy.status}; angka pembagian hanya boleh dipakai setelah disetujui pemilik.`,
    );
    return { valid: false, errors };
  }

  checkRate(policy.memberShareRate, "Persentase bagi hasil anggota", errors);
  checkRate(policy.reserveRate, "Cadangan wajib", errors);
  checkRate(policy.managementFeeRate, "Biaya pengelolaan", errors);

  if (policy.lossHandling === null) {
    errors.push("Kebijakan periode rugi belum ditetapkan.");
  } else if (!(LOSS_HANDLING_OPTIONS as readonly string[]).includes(policy.lossHandling)) {
    errors.push(`Kebijakan periode rugi "${policy.lossHandling}" tidak dikenal.`);
  }

  const reserve = policy.reserveRate;
  const management = policy.managementFeeRate;
  if (reserve && management && reserve.plus(management).gt(1)) {
    errors.push("Total cadangan dan biaya pengelolaan tidak boleh melebihi 100% dari net P&L.");
  }

  if (!policy.approvedByUserId) {
    errors.push("Kebijakan belum mencantumkan admin yang menyetujui.");
  }
  if (!policy.approvedAt) {
    errors.push("Kebijakan belum mencantumkan waktu persetujuan.");
  }

  return { valid: errors.length === 0, errors };
}

/** Ringkasan untuk UI/dokumen: menegaskan bahwa modul ini belum punya angka resmi. */
export function describePolicyGap(policy: ProfitSharePolicyInput): string {
  const result = validateProfitSharePolicy(policy);
  if (result.valid) {
    return "Kebijakan bagi hasil sudah disetujui pemilik dan siap dipakai.";
  }
  return result.errors.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Lapisan PERJANJIAN (bagian 3 permintaan)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Versi struktur snapshot perjanjian. Naikkan angka ini bila bentuk snapshot
 * berubah, supaya snapshot lama tetap bisa dikenali saat dibaca kembali.
 */
export const AGREEMENT_SNAPSHOT_VERSION = "1";

/**
 * Istilah tertulis yang wajib ada pada perjanjian. Semua teks bebas: sistem
 * hanya memeriksa bahwa isinya ADA, tidak pernah mengarang isinya.
 */
export interface AgreementTerms {
  /** Nomor perjanjian pada dokumen asli. */
  agreementNumber: string | null;
  /** Versi perjanjian, mis. "1.0". */
  agreementVersion: string | null;
  /** Metode perhitungan pembagian hasil. */
  distributionMethod: string | null;
  /** Dasar perhitungan (P&L mana yang dipakai). */
  pnlBasis: string | null;
  /** Perlakuan biaya dalam perhitungan. */
  costTreatment: string | null;
  /** Ketentuan periode perhitungan. */
  periodDefinition: string | null;
  /** Ketentuan koreksi laporan yang sudah terbit. */
  correctionTerms: string | null;
  /** Ketentuan penyelesaian sengketa. */
  disputeTerms: string | null;
  /** Kunci berkas dokumen perjanjian di penyimpanan privat. */
  agreementDocumentKey: string | null;
  /** Tanggal perjanjian mulai berlaku. */
  effectiveFrom: Date | null;
  /** Tanggal perjanjian berakhir; null = masih berlaku. */
  effectiveTo?: Date | null;
}

/** Satu pihak yang menyetujui perjanjian beserta buktinya. */
export interface AgreementPartyInput {
  partyName: string;
  partyRole: string;
  agreedAt?: Date | null;
  evidenceStorageKey?: string | null;
}

/** Kebijakan bagi hasil + istilah perjanjian + pihak yang menyetujui. */
export interface ProfitAgreementInput extends ProfitSharePolicyInput, AgreementTerms {
  parties: readonly AgreementPartyInput[];
}

const AGREEMENT_TEXT_TERMS: readonly (keyof AgreementTerms)[] = [
  "agreementNumber",
  "agreementVersion",
  "distributionMethod",
  "pnlBasis",
  "costTreatment",
  "periodDefinition",
  "correctionTerms",
  "disputeTerms",
  "agreementDocumentKey",
];

const AGREEMENT_TERM_LABELS: Record<string, string> = {
  agreementNumber: "Nomor perjanjian",
  agreementVersion: "Versi perjanjian",
  distributionMethod: "Metode perhitungan pembagian",
  pnlBasis: "Dasar perhitungan P&L",
  costTreatment: "Perlakuan biaya",
  periodDefinition: "Ketentuan periode",
  correctionTerms: "Ketentuan koreksi",
  disputeTerms: "Ketentuan sengketa",
  agreementDocumentKey: "Dokumen perjanjian",
  effectiveFrom: "Tanggal mulai berlaku",
};

/**
 * Memeriksa perjanjian secara utuh.
 *
 * Selain seluruh aturan angka pada `validateProfitSharePolicy`, perjanjian hanya
 * dianggap sah bila istilah tertulis, tanggal berlaku, dokumen, dan sekurangnya
 * satu pihak yang menyetujui (lengkap dengan waktu persetujuan) sudah ada.
 * Kekurangan apa pun membuat hasilnya `valid: false` — inilah yang menjaga laporan
 * tidak pernah dihitung dengan syarat yang belum disepakati.
 */
export function validateProfitAgreement(input: ProfitAgreementInput): PolicyValidationResult {
  const errors = [...validateProfitSharePolicy(input).errors];

  for (const term of AGREEMENT_TEXT_TERMS) {
    const value = input[term];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${AGREEMENT_TERM_LABELS[term] ?? term} belum diisi.`);
    }
  }

  if (!input.effectiveFrom) {
    errors.push(`${AGREEMENT_TERM_LABELS.effectiveFrom} belum diisi.`);
  }
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
    errors.push("Tanggal berakhir perjanjian harus setelah tanggal mulai berlaku.");
  }

  const parties = input.parties.filter((party) => party.partyName.trim().length > 0);
  if (parties.length === 0) {
    errors.push("Perjanjian belum mencantumkan pihak yang menyetujui.");
  } else {
    for (const party of parties) {
      if (party.partyRole.trim().length === 0) {
        errors.push(`Peran pihak "${party.partyName}" belum diisi.`);
      }
      if (!party.agreedAt) {
        errors.push(`Waktu persetujuan pihak "${party.partyName}" belum diisi.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Ringkasan kekurangan perjanjian untuk ditampilkan ke pemilik. */
export function describeAgreementGaps(input: ProfitAgreementInput): string {
  const result = validateProfitAgreement(input);
  if (result.valid) {
    return "Perjanjian bagi hasil sudah lengkap dan disetujui para pihak.";
  }
  return result.errors.join(" ");
}

/** Bentuk snapshot perjanjian yang disimpan pada setiap perhitungan laporan. */
export interface AgreementSnapshot {
  snapshotVersion: string;
  capturedAt: string;
  agreementNumber: string | null;
  agreementVersion: string | null;
  status: ProfitSharePolicyStatus;
  rates: {
    memberShareRate: string | null;
    reserveRate: string | null;
    managementFeeRate: string | null;
  };
  terms: {
    distributionMethod: string | null;
    pnlBasis: string | null;
    costTreatment: string | null;
    periodDefinition: string | null;
    correctionTerms: string | null;
    disputeTerms: string | null;
  };
  lossHandling: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  hasAgreementDocument: boolean;
  parties: Array<{
    partyName: string;
    partyRole: string;
    agreedAt: string | null;
    hasEvidence: boolean;
  }>;
  validation: PolicyValidationResult;
}

/**
 * Membuat snapshot perjanjian yang aman disimpan sebagai JSON.
 *
 * Aturan penting: snapshot hanya berisi SALINAN nilai. Ia tidak menunjuk balik ke
 * baris perjanjian yang hidup, sehingga menyetujui versi baru tidak pernah
 * mengubah laporan yang sudah dihitung. Kunci berkas dokumen/bukti sengaja diganti
 * boolean (`hasAgreementDocument`, `hasEvidence`) karena kunci itu rahasia.
 */
export function buildPolicySnapshot(
  input: ProfitAgreementInput,
  capturedAt: Date = new Date(),
): AgreementSnapshot {
  return {
    snapshotVersion: AGREEMENT_SNAPSHOT_VERSION,
    capturedAt: capturedAt.toISOString(),
    agreementNumber: input.agreementNumber,
    agreementVersion: input.agreementVersion,
    status: input.status,
    rates: {
      memberShareRate: rateOrNull(input.memberShareRate),
      reserveRate: rateOrNull(input.reserveRate),
      managementFeeRate: rateOrNull(input.managementFeeRate),
    },
    terms: {
      distributionMethod: input.distributionMethod,
      pnlBasis: input.pnlBasis,
      costTreatment: input.costTreatment,
      periodDefinition: input.periodDefinition,
      correctionTerms: input.correctionTerms,
      disputeTerms: input.disputeTerms,
    },
    lossHandling: input.lossHandling,
    effectiveFrom: input.effectiveFrom ? input.effectiveFrom.toISOString() : null,
    effectiveTo: input.effectiveTo ? input.effectiveTo.toISOString() : null,
    hasAgreementDocument: Boolean(input.agreementDocumentKey),
    parties: input.parties.map((party) => ({
      partyName: party.partyName,
      partyRole: party.partyRole,
      agreedAt: party.agreedAt ? party.agreedAt.toISOString() : null,
      hasEvidence: Boolean(party.evidenceStorageKey),
    })),
    validation: validateProfitAgreement(input),
  };
}

/** Rasio menjadi string skala 4 desimal supaya snapshot pasti JSON-safe. */
function rateOrNull(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(RATE_SCALE);
}
