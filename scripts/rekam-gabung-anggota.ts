import { Prisma, PrismaClient } from "@prisma/client";

import { assertConfirmed } from "../src/lib/config/maintenance-guard";
import { storeProofFile } from "../src/lib/payment-proof";
import type { RequestMeta } from "../src/lib/security";
import {
  createDepositRequest,
  reviewDepositRequest,
} from "../src/lib/services/manual-payment-service";
import { joinProgramTier } from "../src/lib/services/program-service";

/**
 * Alat operator: merekam keanggotaan program dan setoran anggota yang sudah
 * disetujui pemilik.
 *
 * Berbeda dari `demo:local` (yang membuat akun palsu dan dilarang di produksi),
 * skrip ini tidak membuat akun dan tidak menebak apa pun: ia memakai akun yang
 * sudah ada lalu menjalankan **layanan yang sama** dengan yang dipakai aplikasi
 * (`joinProgramTier`, `createDepositRequest`, `reviewDepositRequest`), sehingga
 * buku besar, imbalan periode pertama, notifikasi, dan audit ditulis oleh kode
 * produksi — bukan oleh tulisan SQL langsung.
 *
 * Skrip berhenti tanpa `--confirm`, boleh dijalankan di produksi (memang untuk
 * itu), dan idempoten: keanggotaan yang sudah ada dipakai ulang, setoran yang
 * masih terbuka tidak digandakan, dan setoran yang sudah disetujui tidak
 * disetujui dua kali.
 *
 * Contoh (produksi, satu akun, paket 100 USDT, kontrak 12 minggu):
 *
 *   npm run akun:gabung -- --pengguna barusta --paket USDT-100 --durasi 12 \
 *     --setor 100 --metode CRYPTO --referensi "Setoran manual pemilik" \
 *     --setujui --confirm
 */

const prisma = new PrismaClient();

/** Meta audit untuk tindakan yang dijalankan operator dari terminal. */
const OPERATOR_META: RequestMeta = {
  ipAddress: null,
  userAgent: "alat-operator/rekam-gabung-anggota",
};

const ALLOWED_CYCLE_WEEKS = [4, 8, 12] as const;
const OPEN_DEPOSIT_STATUSES = ["PENDING", "UNDER_REVIEW", "APPROVED"] as const;

/** Nilai `--nama nilai` atau `--nama=nilai`. */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

/** Bendera tanpa nilai, mis. `--setujui`. */
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Membangun satu halaman PDF kecil berisi catatan operator.
 *
 * Dipakai sebagai lampiran setoran yang dicatat tanpa transfer eksternal, supaya
 * tidak ada "bukti transfer" palsu: berkasnya memang menyatakan bahwa setoran
 * dicatat manual oleh pemilik. Ditulis tangan agar tidak menambah dependensi.
 */
function buildInternalNotePdf(lines: string[]): Uint8Array {
  const escape = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const body = [
    "BT",
    "/F1 11 Tf",
    "16 TL",
    "60 780 Td",
    ...lines.map((line, index) => (index === 0 ? `(${escape(line)}) Tj` : `T* (${escape(line)}) Tj`)),
    "ET",
  ].join("\n");

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${body.length}>>\nstream\n${body}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

const money = (value: { toString(): string } | null | undefined, currency = "USDT") =>
  value === null || value === undefined ? "n/a" : `${value.toString()} ${currency}`;

async function main() {
  const username = arg("pengguna");
  const tierCode = arg("paket") ?? "USDT-100";
  const cycleArg = arg("durasi") ?? "4";
  const depositArg = arg("setor");
  const paymentMethod = arg("metode") ?? "CRYPTO";
  const paymentReference = arg("referensi") ?? "Setoran dicatat operator";
  const approveNow = flag("setujui");

  assertConfirmed(
    process.argv,
    "skrip ini menulis keanggotaan dan setoran nyata; ulangi dengan --confirm",
  );

  if (!username) fail("Wajib: --pengguna <username>");
  const cycleWeeks = Number(cycleArg);
  if (!ALLOWED_CYCLE_WEEKS.includes(cycleWeeks as (typeof ALLOWED_CYCLE_WEEKS)[number])) {
    fail(`--durasi harus salah satu dari ${ALLOWED_CYCLE_WEEKS.join(", ")} minggu.`);
  }
  const depositAmount = depositArg === undefined ? null : Number(depositArg);
  if (depositAmount !== null && (!Number.isFinite(depositAmount) || depositAmount <= 0)) {
    fail("--setor harus berupa angka positif (mis. --setor 100).");
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, name: true, status: true, role: true, adminRole: true },
  });
  if (!user) fail(`Akun "${username}" tidak ditemukan.`);
  if (user.status !== "ACTIVE") fail(`Akun "${username}" berstatus ${user.status}; hanya akun ACTIVE yang boleh gabung.`);

  const tier = await prisma.programTier.findFirst({
    where: { code: tierCode, isActive: true },
    select: { id: true, code: true, name: true, joinAmount: true, currency: true, programId: true },
  });
  if (!tier) fail(`Paket "${tierCode}" tidak ada/tidak aktif. Jalankan dulu: npm run db:seed`);

  const cycle = await prisma.programCycle.findFirst({
    where: { programId: tier.programId, cycleWeeks, isActive: true },
    select: { id: true, cycleWeeks: true, weeklyRewardRate: true, targetCycleRewardRate: true },
  });
  if (!cycle) fail(`Durasi ${cycleWeeks} minggu tidak ada/tidak aktif untuk paket ${tierCode}.`);

  console.log(`Akun   : ${user.username} (${user.name}) — ${user.role}${user.adminRole ? `/${user.adminRole}` : ""}`);
  console.log(`Paket  : ${tier.code} — ${money(tier.joinAmount, tier.currency)}`);
  console.log(
    `Kontrak: ${cycle.cycleWeeks} minggu · ${cycle.weeklyRewardRate.times(100).toString()}%/minggu · target siklus ${cycle.targetCycleRewardRate.times(100).toString()}%`,
  );

  let membership = await prisma.userProgram.findFirst({
    where: { userId: user.id, tierId: tier.id, cycleWeeks },
    select: {
      id: true,
      status: true,
      joinAmount: true,
      currency: true,
      cycleWeeks: true,
      weeklyRewardRate: true,
      fundsConfirmedAt: true,
      fundsConfirmedAmount: true,
    },
  });

  if (!membership) {
    const joined = await joinProgramTier(user.id, tier.id, OPERATOR_META, undefined, cycle.id);
    console.log(`+ gabung tercatat (${joined.status}) → keanggotaan ${joined.userProgramId}`);
    membership = await prisma.userProgram.findFirstOrThrow({
      where: { id: joined.userProgramId },
      select: {
        id: true,
        status: true,
        joinAmount: true,
        currency: true,
        cycleWeeks: true,
        weeklyRewardRate: true,
        fundsConfirmedAt: true,
        fundsConfirmedAmount: true,
      },
    });
  } else {
    console.log(`= keanggotaan dipakai ulang (${membership.status}) → ${membership.id}`);
  }

  const amount =
    depositAmount === null ? new Prisma.Decimal(membership.joinAmount) : new Prisma.Decimal(depositAmount);

  const openDeposit = await prisma.depositRequest.findFirst({
    where: { userProgramId: membership.id, status: { in: [...OPEN_DEPOSIT_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, amount: true, currency: true, createdAt: true },
  });

  let depositId = openDeposit?.id ?? null;
  if (openDeposit) {
    console.log(
      `= setoran sudah ada (${openDeposit.status} ${money(openDeposit.amount, openDeposit.currency)}) → ${openDeposit.id}`,
    );
  } else {
    const stored = await storeProofFile({
      bytes: buildInternalNotePdf([
        "Catatan setoran internal",
        "",
        `Anggota   : ${user.username} (${user.name})`,
        `Paket     : ${tier.code} · kontrak ${cycle.cycleWeeks} minggu`,
        `Nominal   : ${amount.toFixed(2)} ${tier.currency}`,
        `Metode    : ${paymentMethod}`,
        "",
        "Setoran ini dicatat langsung oleh pemilik melalui alat operator.",
        "Tidak ada berkas transfer eksternal yang dilampirkan; halaman ini",
        "menggantikannya sebagai lampiran resmi catatan setoran.",
      ]),
      kind: "pdf",
      originalName: `catatan-setoran-${user.username}.pdf`,
    });

    const created = await createDepositRequest({
      userId: user.id,
      userProgramId: membership.id,
      amount,
      paymentMethod,
      paymentReference,
      proof: {
        storageKey: stored.storagePath,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        size: stored.sizeBytes,
      },
      meta: OPERATOR_META,
    });
    depositId = created.id;
    console.log(`+ setoran dicatat (${created.status} ${money(created.amount, created.currency)}) → ${created.id}`);
  }

  if (approveNow && depositId) {
    const current = await prisma.depositRequest.findUniqueOrThrow({
      where: { id: depositId },
      select: { status: true },
    });
    if (current.status === "PENDING" || current.status === "UNDER_REVIEW") {
      const reviewed = await reviewDepositRequest({
        depositId,
        actorUserId: user.id,
        actorAdminRole: user.adminRole,
        action: "APPROVED",
        note: "Disetujui pemilik lewat alat operator: dana sudah diterima di luar platform.",
        meta: OPERATOR_META,
      });
      console.log(`+ setoran disetujui → ${reviewed.status}`);
    } else {
      console.log(`= setoran sudah ${current.status}; persetujuan tidak diulang`);
    }
  }

  const [finalMembership, deposits, rewards, balance] = await Promise.all([
    prisma.userProgram.findUniqueOrThrow({
      where: { id: membership.id },
      select: {
        status: true,
        cycleWeeks: true,
        weeklyRewardRate: true,
        maxCycleRewardRate: true,
        joinAmount: true,
        currency: true,
        fundsConfirmedAmount: true,
        activatedAt: true,
      },
    }),
    prisma.depositRequest.findMany({
      where: { userProgramId: membership.id },
      orderBy: { createdAt: "asc" },
      select: { status: true, amount: true, currency: true, paymentMethod: true, reviewedAt: true },
    }),
    prisma.reward.findMany({
      where: { userId: user.id },
      orderBy: [{ cycleNumber: "asc" }, { period: "asc" }],
      select: { status: true, cycleNumber: true, period: true, amount: true, currency: true },
    }),
    prisma.balance.findUnique({
      where: { userId: user.id },
      select: {
        availableAmount: true,
        pendingAmount: true,
        programFundsAmount: true,
        totalEarned: true,
        currency: true,
      },
    }),
  ]);

  console.log("\nHasil");
  console.log(
    `  keanggotaan: ${finalMembership.status} · ${finalMembership.cycleWeeks} minggu · ${finalMembership.weeklyRewardRate.times(100).toString()}%/minggu · dana terkonfirmasi ${money(finalMembership.fundsConfirmedAmount, finalMembership.currency)}`,
  );
  for (const row of deposits) {
    console.log(`  setoran    : ${row.status} ${money(row.amount, row.currency)} (${row.paymentMethod})`);
  }
  for (const row of rewards) {
    console.log(
      `  imbalan    : siklus ${row.cycleNumber} ${row.period} ${row.status} ${money(row.amount, row.currency)}`,
    );
  }
  console.log(
    `  saldo      : tersedia ${money(balance?.availableAmount, balance?.currency ?? "USDT")} · menunggu ${money(balance?.pendingAmount, balance?.currency ?? "USDT")} · dana program ${money(balance?.programFundsAmount, balance?.currency ?? "USDT")}`,
  );
  console.log(`  total hasil: ${money(balance?.totalEarned, balance?.currency ?? "USDT")}`);
}

main()
  .catch((error) => {
    console.error("\nGagal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());