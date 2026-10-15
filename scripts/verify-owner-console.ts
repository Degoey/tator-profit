import process from "node:process";

import bcrypt from "bcryptjs";

import {
  APP_DATABASE_URL_ENV,
  describeDatabaseTarget,
  loadDatabaseEnvFile,
  resolveTestDatabaseUrl,
} from "../src/lib/config/test-database";

/**
 * Verifikasi Konsol Pemilik terhadap aplikasi yang benar-benar berjalan.
 *
 * Skrip ini **tidak** menyentuh database aplikasi: ia menyiapkan akun uji di
 * database uji (`TEST_DATABASE_URL`), lalu menguji alur lewat HTTP — masuk,
 * penolakan sebelum sidik jari terdaftar, opsi pendaftaran WebAuthn, penolakan
 * sebelum verifikasi sesi, pembukaan seluruh halaman konsol, kredit saldo (termasuk
 * idempotensi), dan penolakan bagi akun yang bukan pemilik.
 *
 * **Batas yang tidak dapat diuji lewat HTTP.** 2FA TOTP sudah diganti passkey
 * WebAuthn. Upacara pendaftaran dan verifikasi passkey harus ditandatangani perangkat
 * pemilik — kunci privat tidak pernah meninggalkan peramban — sehingga tidak ada cara
 * menjalankannya dari skrip HTTP biasa. Bagian itu WAJIB diuji manual di peramban
 * (lihat blok "SIMULASI" di bawah); skrip ini hanya menyiapkan keadaan
 * pasca-verifikasi supaya penjaga server dan rute uang tetap dapat diperiksa.
 *
 * Pemakaian:
 *   1. `npm run db:test:setup`
 *   2. jalankan aplikasi pada database uji, mis.
 *      `PORT=3210 DATABASE_URL="$TEST_DATABASE_URL" OWNER_EMAIL=... npm run dev`
 *   3. `OWNER_EMAIL=... npm run verify:owner -- --base-url http://127.0.0.1:3210`
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const OWNER_PASSWORD = "RahasiaPemilik123";
const ADMIN_PASSWORD = "RahasiaAdmin123";
const MEMBER_PASSWORD = "RahasiaAnggota123";

type CheckResult = { name: string; ok: boolean; detail: string };

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail = ""): boolean {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " GAGAL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function isRedirect(status: number): boolean {
  return status === 302 || status === 303 || status === 307 || status === 308;
}

interface HttpResult {
  status: number;
  location: string | null;
  body: string;
  json: unknown;
}

class Session {
  private cookie = "";

  constructor(private readonly baseUrl: string) {}

  get cookieHeader(): string {
    return this.cookie;
  }

  private absorb(response: Response): void {
    const cookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of cookies) {
      const [pair] = raw.split(";");
      if (!pair) continue;
      const [name] = pair.split("=");
      if (name === "tatorprofit_session" || name?.includes("session")) {
        this.cookie = pair;
      }
    }
  }

  async request(
    path: string,
    init: { method?: string; body?: unknown; origin?: string | null; follow?: boolean } = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    if (init.origin !== null) headers.origin = init.origin ?? this.baseUrl;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: init.follow ? "follow" : "manual",
    });
    this.absorb(response);

    const body = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(body) as unknown;
    } catch {
      json = null;
    }

    return {
      status: response.status,
      location: response.headers.get("location"),
      body,
      json,
    };
  }

  get(path: string): Promise<HttpResult> {
    return this.request(path);
  }

  post(path: string, body?: unknown, origin?: string | null): Promise<HttpResult> {
    return this.request(path, { method: "POST", body, origin });
  }
}

function payload<T>(result: HttpResult): T | null {
  const json = result.json as { ok?: boolean; data?: T } | null;
  if (!json || json.ok !== true) return null;
  return (json.data ?? null) as T | null;
}

function errorCode(result: HttpResult): string {
  const json = result.json as { code?: string } | null;
  return json?.code ?? "";
}

async function main(): Promise<void> {
  loadDatabaseEnvFile();

  const baseUrl = (argValue("--base-url") ?? process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const testUrl = resolveTestDatabaseUrl();
  const ownerEmail = (process.env.OWNER_EMAIL ?? "").trim();
  if (!ownerEmail) {
    throw new Error(
      "OWNER_EMAIL wajib diisi pada lingkungan skrip ini dan harus sama dengan nilai yang dipakai aplikasi yang sedang berjalan.",
    );
  }

  /** Aplikasi yang sedang berjalan harus menunjuk database uji yang sama. */
  const appUrl = (process.env[APP_DATABASE_URL_ENV] ?? "").trim();
  console.log(`Konsol Pemilik di  : ${baseUrl}`);
  console.log(`Database uji       : ${describeDatabaseTarget(testUrl)}`);
  console.log(`Database aplikasi  : ${appUrl ? describeDatabaseTarget(appUrl) : "(tidak dibaca)"}`);

  process.env.DATABASE_URL = testUrl;
  const { prisma } = await import("../src/lib/prisma");

  const passwordHash = {
    owner: await bcrypt.hash(OWNER_PASSWORD, 12),
    admin: await bcrypt.hash(ADMIN_PASSWORD, 12),
    member: await bcrypt.hash(MEMBER_PASSWORD, 12),
  };

  const owner = await prisma.user.upsert({
    where: { username: "pemilik-uji" },
    update: {
      email: ownerEmail,
      role: "ADMIN",
      adminRole: "SUPER_ADMIN",
      status: "ACTIVE",
      passwordHash: passwordHash.owner,
    },
    create: {
      name: "Pemilik Uji",
      username: "pemilik-uji",
      email: ownerEmail,
      phone: "081200000001",
      passwordHash: passwordHash.owner,
      role: "ADMIN",
      adminRole: "SUPER_ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  /** Mulai dari keadaan "belum ada sidik jari" supaya jalur pendaftaran teruji. */
  await prisma.ownerPasskey.deleteMany({ where: { userId: owner.id } });
  await prisma.user.update({ where: { id: owner.id }, data: { ownerPasskeyChallenge: null } });

  const otherAdmin = await prisma.user.upsert({
    where: { username: "admin-uji-lain" },
    update: {
      role: "ADMIN",
      adminRole: "FINANCE",
      status: "ACTIVE",
      passwordHash: passwordHash.admin,
    },
    create: {
      name: "Admin Uji Lain",
      username: "admin-uji-lain",
      email: "admin-lain@tatorprofit.test",
      phone: "081200000002",
      passwordHash: passwordHash.admin,
      role: "ADMIN",
      adminRole: "FINANCE",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.user.upsert({
    where: { username: "anggota-uji" },
    update: { role: "USER", adminRole: null, status: "ACTIVE", passwordHash: passwordHash.member },
    create: {
      name: "Anggota Uji",
      username: "anggota-uji",
      email: "anggota-uji@tatorprofit.test",
      phone: "081200000003",
      passwordHash: passwordHash.member,
      role: "USER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  /** Kredit memakai referensi unik supaya pengujian ulang tidak menumpuk saldo. */
  const reference = `e2e-owner-${Date.now()}`;
  const balanceBefore =
    (
      await prisma.balance.findUnique({
        where: { userId: member.id },
        select: { availableAmount: true },
      })
    )?.availableAmount ?? null;

  const session = new Session(baseUrl);

  console.log("\n== Akun pemilik ==");
  const login = await session.post("/api/auth/login", {
    identifier: owner.username,
    password: OWNER_PASSWORD,
  });
  check("masuk sebagai pemilik berhasil", login.status === 200, `HTTP ${login.status}`);

  const beforeEnrollment = await session.get("/owner");
  check(
    "halaman /owner belum dapat dibuka sebelum sidik jari terdaftar",
    isRedirect(beforeEnrollment.status),
    `HTTP ${beforeEnrollment.status} → ${beforeEnrollment.location ?? "-"}`,
  );

  const securityWhileUnenrolled = await session.get("/owner/keamanan");
  check(
    "halaman keamanan tetap terbuka untuk mendaftarkan sidik jari",
    securityWhileUnenrolled.status === 200,
    `HTTP ${securityWhileUnenrolled.status}`,
  );

  const setup = await session.post("/api/owner/passkey/register-options");
  const setupData = payload<{
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string };
  }>(setup);
  check(
    "opsi pendaftaran passkey berisi tantangan dan RP ID",
    setup.status === 200 &&
      typeof setupData?.challenge === "string" &&
      setupData.challenge.length > 0 &&
      !!setupData?.rp?.id,
    `HTTP ${setup.status} · rp.id=${setupData?.rp?.id ?? "-"}`,
  );

  const authWithoutCredential = await session.post("/api/owner/passkey/authenticate-options");
  check(
    "verifikasi ditolak selama belum ada kredensial terdaftar",
    authWithoutCredential.status === 409 &&
      errorCode(authWithoutCredential) === "OWNER_PASSKEY_NOT_ENROLLED",
    `HTTP ${authWithoutCredential.status} ${errorCode(authWithoutCredential)}`,
  );

  /**
   * SIMULASI — menggantikan upacara WebAuthn yang sesungguhnya.
   *
   * `register-verify` dan `authenticate-verify` hanya sah bila ditandatangani
   * perangkat pemilik, sehingga tidak dapat dijalankan dari skrip HTTP biasa: tidak
   * ada kunci privat di sini, dan server memang menolak balasan yang tidak dapat
   * diverifikasi. Jadi, untuk menguji penjaga server dan rute uang di bawah, keadaan
   * "sudah ada kredensial + sesi ini sudah diverifikasi" disiapkan langsung di
   * database uji.
   *
   * Upacara passkey yang sesungguhnya WAJIB diuji manual di peramban:
   *   1. buka /owner/keamanan, tekan "Daftarkan sidik jari", sentuh sensor;
   *   2. /owner harus mengalihkan ke /owner/masuk, lalu "Verifikasi dengan sidik jari"
   *      harus membuka /owner;
   *   3. hapus kredensial terakhir di /owner/keamanan dan pastikan konsol kembali
   *      meminta pendaftaran.
   */
  console.log("\n== Simulasi keadaan pasca-verifikasi (upacara passkey diuji manual) ==");
  const fixtureCredentialId = `e2e-owner-passkey-${owner.id}`;
  await prisma.ownerPasskey.upsert({
    where: { credentialId: fixtureCredentialId },
    update: { userId: owner.id },
    create: {
      userId: owner.id,
      credentialId: fixtureCredentialId,
      publicKey: Buffer.from([1, 2, 3, 4]),
      counter: 0n,
      deviceType: "singleDevice",
      backedUp: false,
      transports: ["internal"],
      friendlyName: "Perangkat uji",
    },
  });
  check(
    "kredensial uji tersimpan (meniru hasil pendaftaran passkey)",
    (await prisma.ownerPasskey.count({ where: { userId: owner.id } })) === 1,
    fixtureCredentialId,
  );

  const beforeStepUp = await session.get("/owner");
  check(
    "sesi yang belum diverifikasi masih dialihkan ke halaman verifikasi",
    isRedirect(beforeStepUp.status),
    `HTTP ${beforeStepUp.status} → ${beforeStepUp.location ?? "-"}`,
  );

  const blockedBeforeStepUp = await session.post("/api/owner/credits", {
    userId: member.id,
    amount: "1000",
    reason: "Uji konsol pemilik",
    reference,
  });
  check(
    "rute uang menolak sesi yang belum lolos verifikasi sidik jari",
    blockedBeforeStepUp.status === 401 && errorCode(blockedBeforeStepUp) === "OWNER_PASSKEY_REQUIRED",
    `HTTP ${blockedBeforeStepUp.status} ${errorCode(blockedBeforeStepUp)}`,
  );

  const ownerSession = await prisma.session.findFirst({
    where: { userId: owner.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!ownerSession) {
    throw new Error("Sesi pemilik tidak ditemukan; masuk sebagai pemilik harus membuat satu sesi.");
  }
  await prisma.session.update({
    where: { id: ownerSession.id },
    data: { totpVerifiedAt: new Date() },
  });
  check(
    "sesi uji ditandai sudah diverifikasi (meniru hasil verifikasi passkey)",
    true,
    ownerSession.id,
  );

  console.log("\n== Halaman konsol ==");
  for (const path of [
    "/owner",
    "/owner/pengguna",
    `/owner/pengguna/${member.id}`,
    "/owner/audit",
    "/owner/keamanan",
  ]) {
    const page = await session.get(path);
    check(`halaman ${path} terbuka`, page.status === 200, `HTTP ${page.status}`);
  }

  const overview = await session.get("/owner");
  check(
    "ringkasan memuat angka nyata dari database",
    overview.body.includes("Ringkasan") || overview.body.includes("antrean"),
    `panjang ${overview.body.length} karakter`,
  );

  console.log("\n== Tindakan uang ==");
  const credit = await session.post("/api/owner/credits", {
    userId: member.id,
    amount: "1000",
    reason: "Uji konsol pemilik",
    reference,
  });
  check("kredit saldo diterima", credit.status === 201, `HTTP ${credit.status} ${errorCode(credit)}`);

  const creditAgain = await session.post("/api/owner/credits", {
    userId: member.id,
    amount: "1000",
    reason: "Uji konsol pemilik",
    reference,
  });
  check(
    "kredit dengan referensi sama bersifat idempoten",
    creditAgain.status === 200,
    `HTTP ${creditAgain.status} ${errorCode(creditAgain)}`,
  );

  const balanceAfter = await prisma.balance.findUnique({
    where: { userId: member.id },
    select: { availableAmount: true },
  });
  const delta =
    balanceAfter && balanceBefore
      ? balanceAfter.availableAmount.minus(balanceBefore)
      : balanceAfter?.availableAmount;
  check(
    "saldo bertambah tepat satu kali (1000 USDT)",
    !!delta && delta.toString() === "1000",
    `selisih ${delta?.toString() ?? "?"} USDT`,
  );

  const ledgerRows = await prisma.transaction.count({ where: { reference: { contains: reference } } });
  check("entri ledger tercatat satu kali", ledgerRows === 1, `${ledgerRows} baris`);

  const auditRows = await prisma.auditLog.findMany({
    where: { action: { contains: "owner" } },
    select: { action: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  check(
    "tindakan pemilik meninggalkan jejak audit",
    auditRows.length > 0,
    auditRows.map((row) => row.action).join(", ") || "(kosong)",
  );

  console.log("\n== Sesi lain ==");
  const revoke = await session.post("/api/owner/sessions/revoke");
  check(
    "pencabutan sesi lain tidak meminta kode tambahan dari sesi terverifikasi",
    revoke.status === 200,
    `HTTP ${revoke.status} ${errorCode(revoke)}`,
  );

  console.log("\n== Akun lain ditolak ==");
  const adminSession = new Session(baseUrl);
  const adminLogin = await adminSession.post("/api/auth/login", {
    identifier: otherAdmin.username,
    password: ADMIN_PASSWORD,
  });
  check("admin lain dapat masuk ke aplikasi", adminLogin.status === 200, `HTTP ${adminLogin.status}`);

  const adminOwnerPage = await adminSession.get("/owner");
  check(
    "admin lain menerima 404 (permukaan tidak diakui)",
    adminOwnerPage.status === 404,
    `HTTP ${adminOwnerPage.status}`,
  );
  const adminOwnerApi = await adminSession.post("/api/owner/passkey/register-options");
  check(
    "rute API konsol menolak admin lain",
    adminOwnerApi.status === 403,
    `HTTP ${adminOwnerApi.status} ${errorCode(adminOwnerApi)}`,
  );

  const memberSession = new Session(baseUrl);
  await memberSession.post("/api/auth/login", {
    identifier: member.username,
    password: MEMBER_PASSWORD,
  });
  const memberOwnerPage = await memberSession.get("/owner");
  check("anggota biasa menerima 404", memberOwnerPage.status === 404, `HTTP ${memberOwnerPage.status}`);

  const crossOrigin = await session.post(
    "/api/owner/passkey/register-options",
    undefined,
    "https://jahat.example.com",
  );
  check(
    "permintaan lintas situs ditolak",
    crossOrigin.status === 403 && errorCode(crossOrigin) === "CROSS_ORIGIN",
    `HTTP ${crossOrigin.status} ${errorCode(crossOrigin)}`,
  );

  const guest = new Session(baseUrl);
  const guestOwner = await guest.get("/owner");
  check(
    "tamu diarahkan ke halaman masuk",
    isRedirect(guestOwner.status),
    `HTTP ${guestOwner.status} → ${guestOwner.location ?? "-"}`,
  );

  await prisma.$disconnect();

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} pemeriksaan lulus.` +
      (failed.length ? ` Gagal: ${failed.map((item) => item.name).join("; ")}` : ""),
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
