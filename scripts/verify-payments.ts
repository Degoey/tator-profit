import { Prisma, PrismaClient } from "@prisma/client";

import { deleteProofFile } from "../src/lib/payment-proof";
import { postLedgerEntry, verifyBalanceInvariant } from "../src/lib/services/ledger-service";

/**
 * End-to-end verification of the manual payment workflow (deposit / withdrawal).
 *
 * Unlike the service level tests in `tests/manual-payment.test.ts`, this script
 * drives the real HTTP surface: it registers accounts, signs them in, joins a
 * program tier, uploads a real proof file through the multipart endpoint, reviews
 * the request through the admin API and then checks PostgreSQL directly.
 *
 * It also asserts the security properties that only exist at the edge:
 * cross-site mutations are refused, a proof can only be downloaded by its owner
 * or by an administrator with the `readProof` capability, and an administrator
 * whose role lacks the capability is refused by the API.
 *
 * Usage: npm run dev (in another terminal) then `npm run verify:payments`.
 * Every account, request, ledger row and audit row it creates is removed again.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const password = "Tator12345";
const stamp = `${Date.now()}`.slice(-7);

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** One browser-like session: keeps the httpOnly session cookie between calls. */
class Session {
  private cookie = "";

  constructor(readonly label: string) {}

  async request(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      form?: FormData;
      origin?: string | null;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const headers: Record<string, string> = { ...init.headers };
    if (this.cookie) headers.cookie = this.cookie;
    if (init.origin !== null) headers.origin = init.origin ?? BASE_URL;

    let body: BodyInit | undefined;
    if (init.form) {
      body = init.form;
    } else if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const entry of setCookie) {
      const [pair] = entry.split(";");
      if (pair?.startsWith("tatorprofit_session=")) this.cookie = pair;
    }

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return { status: response.status, body: parsed, headers: response.headers };
  }

  async register(username: string, name: string) {
    return this.request("/api/auth/register", {
      body: {
        name,
        username,
        email: `${username}@example.com`,
        phone: `+6281${stamp}${Math.floor(Math.random() * 90 + 10)}`,
        password,
        acceptTerms: true,
      },
    });
  }

  async login(identifier: string) {
    return this.request("/api/auth/login", { body: { identifier, password } });
  }
}

/** Copies bytes into a plain ArrayBuffer so they can be used as a Blob part. */
function bytesOf(source: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

/** A 1x1 PNG: the smallest file that passes the signature check. */
function tinyPng(): ArrayBuffer {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return bytesOf(Buffer.from(base64, "base64"));
}

function decimal(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

async function balanceOf(userId: string) {
  const balance = await prisma.balance.findUnique({ where: { userId } });
  return {
    available: decimal(balance?.availableAmount),
    pending: decimal(balance?.pendingAmount),
    programFunds: decimal(balance?.programFundsAmount),
    reserved: decimal(balance?.reservedAmount),
  };
}
async function main() {
  const reachable = await fetch(`${BASE_URL}/login`).catch(() => null);
  check(
    "server aplikasi dapat dijangkau",
    reachable?.status === 200,
    `status=${reachable?.status ?? "tidak ada"}`,
  );
  if (!reachable || reachable.status !== 200) {
    throw new Error(`Jalankan \`npm run dev\` lebih dulu pada ${BASE_URL}.`);
  }

  // ---------------------------------------------------------------- accounts --
  const member = new Session("anggota");
  const memberUsername = `pay_member_${stamp}`;
  const memberRegister = await member.register(memberUsername, "Anggota Verifikasi");
  const memberId = memberRegister.body?.data?.userId as string;
  createdUserIds.push(memberId);
  check(
    "pendaftaran anggota",
    memberRegister.status === 201 && Boolean(memberId),
    `status=${memberRegister.status}`,
  );

  const outsider = new Session("pengguna-lain");
  const outsiderRegister = await outsider.register(`pay_other_${stamp}`, "Pengguna Lain");
  createdUserIds.push(outsiderRegister.body?.data?.userId as string);
  check(
    "pendaftaran pengguna lain",
    outsiderRegister.status === 201,
    `status=${outsiderRegister.status}`,
  );

  const admin = new Session("admin");
  const adminUsername = `pay_admin_${stamp}`;
  const adminRegister = await admin.register(adminUsername, "Admin Verifikasi");
  const adminId = adminRegister.body?.data?.userId as string;
  createdUserIds.push(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { role: "ADMIN", adminRole: "SUPER_ADMIN" },
  });
  const adminLogin = await admin.login(adminUsername);
  check("admin SUPER_ADMIN dapat masuk", adminLogin.status === 200, `status=${adminLogin.status}`);

  const support = new Session("dukungan");
  const supportUsername = `pay_support_${stamp}`;
  const supportRegister = await support.register(supportUsername, "Admin Dukungan");
  const supportId = supportRegister.body?.data?.userId as string;
  createdUserIds.push(supportId);
  await prisma.user.update({
    where: { id: supportId },
    data: { role: "ADMIN", adminRole: "SUPPORT" },
  });
  const supportLogin = await support.login(supportUsername);
  check("admin SUPPORT dapat masuk", supportLogin.status === 200, `status=${supportLogin.status}`);

  // ------------------------------------------------------- program membership --
  const programs = await member.request("/api/programs");
  const tier = programs.body?.data?.tiers?.[0];
  const cycles = (programs.body?.data?.cycles ?? []) as {
    id: string;
    cycleWeeks: number;
    targetCycleRewardRate: string;
  }[];
  check(
    "konfigurasi program, paket, dan durasi terbaca",
    Boolean(tier?.id) &&
      Boolean(tier?.joinAmount) &&
      cycles.length === 3 &&
      cycles.map((cycle) => cycle.cycleWeeks).join(",") === "4,8,12",
    `paket=${tier?.code ?? "-"} durasi=${cycles.map((cycle) => cycle.cycleWeeks).join("/") || "-"}`,
  );

  const twelveWeek = cycles.find((cycle) => cycle.cycleWeeks === 12);
  const join = await member.request("/api/programs/join", {
    body: { tierId: tier.id, cycleId: twelveWeek?.id },
  });
  const userProgramId = join.body?.data?.userProgramId as string;
  const joinAmount = join.body?.data?.joinAmount as string;
  check(
    "anggota gabung kombinasi 12 minggu menjadi keanggotaan menunggu",
    join.status === 201 &&
      join.body?.data?.status === "PENDING" &&
      join.body?.data?.cycleWeeks === 12 &&
      join.body?.data?.targetCycleRewardRate === "1.2000" &&
      Boolean(userProgramId),
    `status=${join.status} nilai=${joinAmount} minggu=${join.body?.data?.cycleWeeks} target=${join.body?.data?.targetCycleRewardRate}`,
  );

  const beforeDeposit = await balanceOf(memberId);
  check(
    "saldo awal anggota nol di semua bucket",
    beforeDeposit.available === "0.00" &&
      beforeDeposit.programFunds === "0.00" &&
      beforeDeposit.reserved === "0.00",
    JSON.stringify(beforeDeposit),
  );

  const context = {
    member,
    outsider,
    admin,
    support,
    memberId,
    adminId,
    userProgramId,
    joinAmount,
  };

  await verifyDepositFlow(context);
  await verifyWithdrawalFlow(context);

  const failed = results.filter((entry) => !entry.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} pemeriksaan lulus.` +
      (failed.length > 0 ? ` Gagal: ${failed.map((entry) => entry.name).join(" | ")}` : ""),
  );
  if (failed.length > 0) process.exitCode = 1;
}

interface FlowContext {
  member: Session;
  outsider: Session;
  admin: Session;
  support: Session;
  memberId: string;
  adminId: string;
  userProgramId: string;
  joinAmount: string;
}

/** Deposit: submit with proof, verify the security edges, then approve it. */
async function verifyDepositFlow(context: FlowContext) {
  const { member, outsider, admin, support, memberId, adminId, userProgramId, joinAmount } = context;

  const crossSite = await member.request("/api/deposits", {
    body: {},
    origin: "https://penyerang.example",
  });
  check(
    "permintaan setoran lintas situs ditolak",
    crossSite.status === 403,
    `status=${crossSite.status} kode=${crossSite.body?.code ?? "-"}`,
  );

  const missingOrigin = await member.request("/api/deposits", { body: {}, origin: null });
  check(
    "permintaan setoran tanpa header Origin ditolak",
    missingOrigin.status === 403,
    `status=${missingOrigin.status}`,
  );

  const form = new FormData();
  form.set("userProgramId", userProgramId);
  form.set("amount", joinAmount);
  form.set("paymentMethod", "BANK_TRANSFER");
  form.set("paymentReference", `TRF-${stamp}`);
  form.set(
    "proof",
    new File([tinyPng()], "bukti-transfer.png", { type: "image/png" }),
  );
  const deposit = await member.request("/api/deposits", { form });
  const depositId = deposit.body?.data?.id as string;
  check(
    "anggota mengirim setoran manual dengan bukti gambar",
    deposit.status === 201 && Boolean(depositId),
    `status=${deposit.status} kode=${deposit.body?.code ?? "-"}`,
  );

  const afterSubmit = await balanceOf(memberId);
  check(
    "pengajuan setoran tidak mengubah saldo apa pun",
    afterSubmit.available === "0.00" && afterSubmit.programFunds === "0.00",
    JSON.stringify(afterSubmit),
  );

  const spoofed = new FormData();
  spoofed.set("userProgramId", userProgramId);
  spoofed.set("amount", joinAmount);
  spoofed.set("paymentMethod", "BANK_TRANSFER");
  spoofed.set(
    "proof",
    new File([bytesOf(Buffer.from("bukan berkas gambar"))], "palsu.png", {
      type: "image/png",
    }),
  );
  const spoofedResult = await member.request("/api/deposits", { form: spoofed });
  check(
    "bukti dengan isi palsu ditolak walau ekstensi dan MIME benar",
    spoofedResult.status >= 400 && spoofedResult.status < 500,
    `status=${spoofedResult.status} kode=${spoofedResult.body?.code ?? "-"}`,
  );

  const duplicate = new FormData();
  duplicate.set("userProgramId", userProgramId);
  duplicate.set("amount", joinAmount);
  duplicate.set("paymentMethod", "BANK_TRANSFER");
  duplicate.set(
    "proof",
    new File([tinyPng()], "bukti-kedua.png", { type: "image/png" }),
  );
  const duplicateResult = await member.request("/api/deposits", { form: duplicate });
  check(
    "setoran kedua untuk keanggotaan yang sama ditolak",
    duplicateResult.status === 409,
    `status=${duplicateResult.status} kode=${duplicateResult.body?.code ?? "-"}`,
  );

  // ------------------------------------------------------------ proof access --
  const proofPath = `/api/deposits/${depositId}/proof`;
  const guest = new Session("tamu");
  const guestProof = await guest.request(proofPath);
  const outsiderProof = await outsider.request(proofPath);
  const ownerProof = await member.request(proofPath);
  const adminProof = await admin.request(proofPath);
  const supportProof = await support.request(proofPath);
  const csp = ownerProof.headers.get("content-security-policy") ?? "";

  check("tamu tidak dapat mengunduh bukti", guestProof.status === 401, `status=${guestProof.status}`);
  check(
    "pengguna lain tidak dapat mengunduh bukti",
    outsiderProof.status === 403,
    `status=${outsiderProof.status}`,
  );
  check(
    "pemilik dapat mengunduh bukti sebagai lampiran yang tidak dapat dijalankan",
    ownerProof.status === 200 &&
      (ownerProof.headers.get("content-disposition") ?? "").startsWith("attachment") &&
      ownerProof.headers.get("x-content-type-options") === "nosniff" &&
      csp.includes("sandbox"),
    `status=${ownerProof.status}`,
  );
  check(
    "admin dengan kemampuan readProof dapat mengunduh bukti",
    adminProof.status === 200 && supportProof.status === 200,
    `admin=${adminProof.status} dukungan=${supportProof.status}`,
  );

  // --------------------------------------------------------- deposit review --
  const supportApprove = await support.request("/api/admin/deposits", {
    body: { id: depositId, action: "APPROVED" },
  });
  check(
    "admin SUPPORT tidak boleh menyetujui setoran (RBAC server-side)",
    supportApprove.status === 403,
    `status=${supportApprove.status} kode=${supportApprove.body?.code ?? "-"}`,
  );

  const approve = await admin.request("/api/admin/deposits", {
    body: { id: depositId, action: "APPROVED", note: "Transfer diverifikasi manual" },
  });
  check(
    "admin SUPER_ADMIN menyetujui setoran",
    approve.status === 200 && approve.body?.data?.status === "APPROVED",
    `status=${approve.status} kode=${approve.body?.code ?? "-"}`,
  );

  const membership = await prisma.userProgram.findUnique({
    where: { id: userProgramId },
    select: { status: true, fundsConfirmedAmount: true, fundsConfirmedAt: true },
  });
  const afterApprove = await balanceOf(memberId);
  check(
    "persetujuan mengaktifkan keanggotaan dan mengkredit dana program (bukan saldo tersedia)",
    membership?.status === "ACTIVE" &&
      membership.fundsConfirmedAt !== null &&
      afterApprove.programFunds === new Prisma.Decimal(joinAmount).toFixed(2) &&
      afterApprove.available === "0.00",
    `status=${membership?.status} dana=${afterApprove.programFunds} tersedia=${afterApprove.available}`,
  );

  const rewardCount = await prisma.reward.count({ where: { userProgramId } });
  check(
    "periode imbalan pertama tercatat oleh mesin imbalan",
    rewardCount >= 1,
    `imbalan=${rewardCount}`,
  );

  const depositAudit = await prisma.auditLog.findFirst({
    where: { entityType: "DepositRequest", entityId: depositId, action: "deposit.approved" },
    select: { id: true, actorUserId: true, before: true, after: true },
  });
  check(
    "keputusan setoran tercatat di jejak audit dengan snapshot sebelum/sesudah",
    Boolean(depositAudit) &&
      depositAudit?.actorUserId === adminId &&
      Boolean(depositAudit?.before) &&
      Boolean(depositAudit?.after),
    `aktor=${depositAudit?.actorUserId === adminId ? "benar" : "salah"}`,
  );

  const approveAgain = await admin.request("/api/admin/deposits", {
    body: { id: depositId, action: "APPROVED" },
  });
  check(
    "keputusan setoran tidak dapat diputar ulang (tidak ada kredit ganda)",
    approveAgain.status === 409,
    `status=${approveAgain.status} kode=${approveAgain.body?.code ?? "-"}`,
  );

  const invariant = await verifyBalanceInvariant(prisma, memberId);
  check(
    "buku besar dan saldo seimbang setelah persetujuan",
    invariant.ok,
    JSON.stringify(invariant.checks),
  );
}

/** Credits spendable balance so a withdrawal has something to reserve. */
async function fundAvailable(userId: string, amount: string) {
  await prisma.$transaction(async (tx) => {
    await postLedgerEntry(tx, {
      userId,
      type: "ADJUSTMENT",
      bucket: "AVAILABLE",
      amount: new Prisma.Decimal(amount),
      reference: `verify:${stamp}:fund:${userId.slice(0, 8)}:${amount}:${Math.random().toString(36).slice(2, 8)}`,
      description: "Saldo uji verifikasi alur penarikan",
    });
  });
}

function withdrawalBody(amount: string) {
  return {
    amount,
    method: "BANK_TRANSFER",
    destination: "BCA 1234567890 a.n. Anggota Verifikasi",
    notes: "Uji verifikasi alur penarikan",
  };
}

/** Withdrawal: reserve, refuse overdraft, complete, reject and return funds. */
async function verifyWithdrawalFlow(context: FlowContext) {
  const { member, admin, support, memberId } = context;

  const tooMuch = await member.request("/api/withdrawals", { body: withdrawalBody("25.00") });
  check(
    "penarikan tanpa saldo tersedia ditolak",
    tooMuch.status === 409,
    `status=${tooMuch.status} kode=${tooMuch.body?.code ?? "-"}`,
  );

  await fundAvailable(memberId, "50.00");
  const funded = await balanceOf(memberId);
  check(
    "saldo tersedia disiapkan untuk menguji penarikan",
    funded.available === "50.00" && funded.reserved === "0.00",
    JSON.stringify(funded),
  );

  const first = await member.request("/api/withdrawals", { body: withdrawalBody("50.00") });
  const withdrawalId = first.body?.data?.id as string;
  check(
    "anggota mengajukan penarikan",
    first.status === 201 && Boolean(withdrawalId),
    `status=${first.status} kode=${first.body?.code ?? "-"}`,
  );

  const reserved = await balanceOf(memberId);
  check(
    "pengajuan penarikan memindahkan dana ke saldo ditahan",
    reserved.available === "0.00" && reserved.reserved === "50.00",
    JSON.stringify(reserved),
  );

  const second = await member.request("/api/withdrawals", { body: withdrawalBody("10.00") });
  check(
    "penarikan kedua saat masih ada penarikan terbuka ditolak",
    second.status === 409,
    `status=${second.status} kode=${second.body?.code ?? "-"}`,
  );

  const supportReview = await support.request("/api/admin/withdrawals", {
    body: { id: withdrawalId, action: "APPROVED" },
  });
  check(
    "admin SUPPORT tidak boleh meninjau penarikan (RBAC server-side)",
    supportReview.status === 403,
    `status=${supportReview.status}`,
  );

  const approved = await admin.request("/api/admin/withdrawals", {
    body: { id: withdrawalId, action: "APPROVED" },
  });
  const processing = await admin.request("/api/admin/withdrawals", {
    body: { id: withdrawalId, action: "PROCESSING" },
  });
  const completed = await admin.request("/api/admin/withdrawals", {
    body: { id: withdrawalId, action: "COMPLETED" },
  });
  check(
    "penarikan melewati tahap disetujui, diproses, lalu selesai",
    approved.status === 200 && processing.status === 200 && completed.status === 200,
    `disetujui=${approved.status} diproses=${processing.status} selesai=${completed.status}`,
  );

  const settled = await balanceOf(memberId);
  check(
    "penarikan selesai mendebit cadangan secara permanen",
    settled.reserved === "0.00" && settled.available === "0.00",
    JSON.stringify(settled),
  );

  const replay = await admin.request("/api/admin/withdrawals", {
    body: { id: withdrawalId, action: "COMPLETED" },
  });
  check(
    "penarikan selesai tidak dapat diputar ulang",
    replay.status === 409,
    `status=${replay.status} kode=${replay.body?.code ?? "-"}`,
  );

  // The completed withdrawal took the whole spendable balance with it, so the
  // rejection scenario funds the account again first.
  await fundAvailable(memberId, "20.00");

  const rejectionWithdrawal = await member.request("/api/withdrawals", {
    body: withdrawalBody("20.00"),
  });
  const rejectionId = rejectionWithdrawal.body?.data?.id as string;
  check(
    "anggota mengajukan penarikan kedua setelah yang pertama selesai",
    rejectionWithdrawal.status === 201 && Boolean(rejectionId),
    `status=${rejectionWithdrawal.status}`,
  );

  const rejectWithoutReason = await admin.request("/api/admin/withdrawals", {
    body: { id: rejectionId, action: "REJECTED" },
  });
  check(
    "penolakan penarikan wajib menyertakan alasan",
    rejectWithoutReason.status === 422,
    `status=${rejectWithoutReason.status} kode=${rejectWithoutReason.body?.code ?? "-"}`,
  );

  const rejected = await admin.request("/api/admin/withdrawals", {
    body: { id: rejectionId, action: "REJECTED", reason: "Data rekening tujuan tidak valid" },
  });
  const afterReject = await balanceOf(memberId);
  check(
    "penolakan penarikan mengembalikan dana ke saldo tersedia",
    rejected.status === 200 && afterReject.available === "20.00" && afterReject.reserved === "0.00",
    `status=${rejected.status} tersedia=${afterReject.available} ditahan=${afterReject.reserved}`,
  );

  const invariant = await verifyBalanceInvariant(prisma, memberId);
  check(
    "buku besar dan saldo seimbang setelah seluruh alur penarikan",
    invariant.ok,
    JSON.stringify(invariant.checks),
  );

  const auditRows = await prisma.auditLog.count({
    where: { entityType: "WithdrawalRequest", entityId: withdrawalId },
  });
  check(
    "setiap perubahan status penarikan tercatat di jejak audit",
    auditRows >= 4,
    `baris=${auditRows}`,
  );
}

/**
 * Removes every row this script created. Ledger rows are append-only, so the
 * teardown opts in to the documented maintenance escape hatch for its own
 * transaction only (see scripts/demo-reset.ts).
 */
async function cleanup() {
  if (createdUserIds.length === 0) return;

  const deposits = await prisma.depositRequest.findMany({
    where: { userId: { in: createdUserIds } },
    select: { id: true, proofStorageKey: true },
  });
  const withdrawals = await prisma.withdrawalRequest.findMany({
    where: { userId: { in: createdUserIds } },
    select: { id: true },
  });

  for (const row of deposits) await deleteProofFile(row.proofStorageKey);

  const entityIds = [...deposits.map((row) => row.id), ...withdrawals.map((row) => row.id)];

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          ...(entityIds.length > 0 ? [{ entityId: { in: entityIds } }] : []),
          { actorUserId: { in: createdUserIds } },
        ],
      },
    });
    await tx.referral.deleteMany({
      where: {
        OR: [{ referrerId: { in: createdUserIds } }, { referredUserId: { in: createdUserIds } }],
      },
    });
    await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  console.log(`Pembersihan: ${createdUserIds.length} akun uji beserta datanya dihapus.`);
}

main()
  .catch((error) => {
    console.error(
      "Verifikasi alur pembayaran gagal:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Pembersihan gagal:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });

