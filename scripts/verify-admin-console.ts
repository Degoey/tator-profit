import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import bcrypt from "bcryptjs";

import {
  APP_DATABASE_URL_ENV,
  describeDatabaseTarget,
  loadDatabaseEnvFile,
  resolveTestDatabaseUrl,
} from "../src/lib/config/test-database";
import { ADMIN_MANIFEST } from "../src/lib/config/admin-manifest";
import { ADMIN_CONSOLE_PATHS } from "../src/lib/config/admin-console";

/**
 * Verifikasi Panel Admin (peran biasa) terhadap aplikasi yang benar-benar berjalan.
 *
 * Skrip ini **tidak** menyentuh database aplikasi: ia menyiapkan satu akun uji per
 * peran admin di database uji (`TEST_DATABASE_URL`), lalu memeriksa lewat HTTP:
 * penolakan tamu dan anggota biasa, penolakan admin tanpa peran, pembukaan setiap
 * halaman panel oleh peran yang berwenang, teks "hanya baca"/"akses terbatas" untuk
 * peran yang tidak berwenang, penolakan API milik pemilik, penolakan permintaan
 * lintas situs, manifest yang dapat diambil sebelum masuk, dan setiap pintasan
 * manifest yang menunjuk halaman yang benar-benar ada.
 *
 * Pemakaian:
 *   1. `npm run db:test:setup`
 *   2. jalankan aplikasi pada database uji, mis.
 *      `PORT=3210 DATABASE_URL="$TEST_DATABASE_URL" npm start`
 *   3. `npm run verify:admin -- --base-url http://127.0.0.1:3210`
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const ADMIN_PASSWORD = "RahasiaAdminPanel123";
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
  contentType: string | null;
  body: string;
  json: unknown;
}

class Session {
  private cookie = "";

  constructor(private readonly baseUrl: string) {}

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
    pathname: string,
    init: { method?: string; body?: unknown; origin?: string | null } = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    if (init.origin !== null) headers.origin = init.origin ?? this.baseUrl;

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
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
      contentType: response.headers.get("content-type"),
      body,
      json,
    };
  }

  get(pathname: string): Promise<HttpResult> {
    return this.request(pathname);
  }

  post(pathname: string, body?: unknown, origin?: string | null): Promise<HttpResult> {
    return this.request(pathname, { method: "POST", body, origin });
  }

  async login(identifier: string, password: string): Promise<boolean> {
    const result = await this.post("/api/auth/login", { identifier, password });
    /**
     * Rute masuk dibatasi 12 percobaan per 5 menit per alamat IP. Bila batas itu
     * tercapai, seluruh pemeriksaan sesudahnya akan tampak "gagal" hanya karena
     * tidak ada sesi — jadi hentikan dengan pesan yang menyebut sebabnya.
     */
    if (result.status === 429) {
      throw new Error(
        "Batas percobaan masuk tercapai (HTTP 429). Tunggu 5 menit atau mulai ulang aplikasi uji, lalu jalankan ulang skrip ini.",
      );
    }
    return result.status === 200;
  }
}

function errorCode(result: HttpResult): string {
  const json = result.json as { code?: string } | null;
  return json?.code ?? "";
}

function bodyHas(result: HttpResult, needle: string): boolean {
  return result.body.includes(needle);
}

async function main(): Promise<void> {
  loadDatabaseEnvFile();

  const baseUrl = (argValue("--base-url") ?? process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const testUrl = resolveTestDatabaseUrl();
  const appUrl = (process.env[APP_DATABASE_URL_ENV] ?? "").trim();

  console.log(`Panel Admin di   : ${baseUrl}`);
  console.log(`Database uji     : ${describeDatabaseTarget(testUrl)}`);
  console.log(`Database aplikasi: ${appUrl ? describeDatabaseTarget(appUrl) : "(tidak dibaca)"}`);

  process.env.DATABASE_URL = testUrl;
  const { prisma } = await import("../src/lib/prisma");

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const memberHash = await bcrypt.hash(MEMBER_PASSWORD, 12);

  /** Satu akun per peran admin, plus satu admin tanpa peran dan satu anggota. */
  const fixtures: { username: string; name: string; adminRole: string | null; role: string }[] = [
    { username: "panel-super", name: "Super Admin Uji", adminRole: "SUPER_ADMIN", role: "ADMIN" },
    { username: "panel-keuangan", name: "Keuangan Uji", adminRole: "FINANCE", role: "ADMIN" },
    { username: "panel-kepatuhan", name: "Kepatuhan Uji", adminRole: "COMPLIANCE", role: "ADMIN" },
    { username: "panel-dukungan", name: "Dukungan Uji", adminRole: "SUPPORT", role: "ADMIN" },
    { username: "panel-pengamat", name: "Pengamat Uji", adminRole: "VIEWER", role: "ADMIN" },
    { username: "panel-tanpa-peran", name: "Admin Tanpa Peran", adminRole: null, role: "ADMIN" },
    { username: "panel-anggota", name: "Anggota Uji", adminRole: null, role: "USER" },
  ];

  let phoneCounter = 100;
  for (const fixture of fixtures) {
    phoneCounter += 1;
    const password = fixture.role === "USER" ? memberHash : passwordHash;
    await prisma.user.upsert({
      where: { username: fixture.username },
      update: {
        role: fixture.role === "USER" ? "USER" : "ADMIN",
        adminRole: (fixture.adminRole ?? null) as never,
        status: "ACTIVE",
        passwordHash: password,
      },
      create: {
        name: fixture.name,
        username: fixture.username,
        email: `${fixture.username}@tatorprofit.test`,
        phone: `0813${phoneCounter}0000`,
        passwordHash: password,
        role: fixture.role === "USER" ? "USER" : "ADMIN",
        adminRole: (fixture.adminRole ?? null) as never,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  }
  console.log("\nAkun uji siap di database uji.\n");

  const guest = new Session(baseUrl);

  console.log("== Tamu ==");
  const guestAdmin = await guest.get("/admin");
  check(
    "tamu diarahkan masuk dari /admin",
    isRedirect(guestAdmin.status) && (guestAdmin.location ?? "").startsWith("/login"),
    `HTTP ${guestAdmin.status} → ${guestAdmin.location ?? "-"}`,
  );

  const manifest = await guest.get("/admin/manifest.webmanifest");
  check(
    "manifest panel dapat diambil sebelum masuk",
    manifest.status === 200 && (manifest.contentType ?? "").includes("application/manifest+json"),
    `HTTP ${manifest.status} · ${manifest.contentType ?? "-"}`,
  );

  const manifestJson = (manifest.json ?? {}) as Record<string, unknown>;
  check(
    "manifest panel memakai id dan start_url /admin",
    manifestJson.id === "/admin" && manifestJson.start_url === "/admin",
    `id=${String(manifestJson.id)} · start_url=${String(manifestJson.start_url)}`,
  );

  const shortcuts = (manifestJson.shortcuts ?? []) as { url: string }[];
  const missingShortcut = shortcuts.find((shortcut) => {
    const page = path.join(
      process.cwd(),
      "src",
      "app",
      ...shortcut.url.replace(/^\//, "").split("/"),
      "page.tsx",
    );
    return !existsSync(page);
  });
  check(
    "setiap pintasan manifest menunjuk halaman yang benar-benar ada",
    shortcuts.length > 0 && missingShortcut === undefined,
    `${shortcuts.length} pintasan${missingShortcut ? ` · hilang: ${missingShortcut.url}` : ""}`,
  );

  const legacyFraud = await guest.get("/fraud-review");
  check(
    "alamat lama /fraud-review dialihkan ke halaman panel",
    isRedirect(legacyFraud.status) && (legacyFraud.location ?? "").endsWith("/admin/fraud"),
    `HTTP ${legacyFraud.status} → ${legacyFraud.location ?? "-"}`,
  );

  console.log("\n== Anggota biasa dan admin tanpa peran ==");
  const member = new Session(baseUrl);
  check(
    "anggota dapat masuk",
    await member.login("panel-anggota", MEMBER_PASSWORD),
    "panel-anggota",
  );
  const memberAdmin = await member.get("/admin");
  check(
    "anggota ditolak dari /admin",
    isRedirect(memberAdmin.status) && (memberAdmin.location ?? "").includes("forbidden"),
    `HTTP ${memberAdmin.status} → ${memberAdmin.location ?? "-"}`,
  );
  const memberDeposit = await member.get("/admin/deposit");
  check(
    "anggota ditolak dari halaman panel mana pun",
    isRedirect(memberDeposit.status) && (memberDeposit.location ?? "").includes("forbidden"),
    `HTTP ${memberDeposit.status} → ${memberDeposit.location ?? "-"}`,
  );

  const noRole = new Session(baseUrl);
  check(
    "admin tanpa peran dapat masuk sebagai akun",
    await noRole.login("panel-tanpa-peran", ADMIN_PASSWORD),
    "panel-tanpa-peran",
  );
  const noRoleAdmin = await noRole.get("/admin");
  check(
    "admin tanpa peran ditolak dari panel (fail closed)",
    isRedirect(noRoleAdmin.status) && (noRoleAdmin.location ?? "").includes("forbidden"),
    `HTTP ${noRoleAdmin.status} → ${noRoleAdmin.location ?? "-"}`,
  );

  console.log("\n== SUPER_ADMIN ==");
  const superAdmin = new Session(baseUrl);
  check(
    "super admin dapat masuk",
    await superAdmin.login("panel-super", ADMIN_PASSWORD),
    "panel-super",
  );
  const superDashboard = await superAdmin.get("/admin");
  check(
    "super admin membuka seluruh halaman panel",
    superDashboard.status === 200 && bodyHas(superDashboard, "Ringkasan admin"),
    `HTTP ${superDashboard.status}`,
  );
  check(
    "panel tidak merender kartu kredit saldo, bahkan untuk super admin",
    !bodyHas(superDashboard, "Kredit saldo administrator"),
    "kartu kredit tetap milik Konsol Pemilik",
  );

  console.log("\n== FINANCE ==");
  const finance = new Session(baseUrl);
  check("keuangan dapat masuk", await finance.login("panel-keuangan", ADMIN_PASSWORD), "panel-keuangan");

  const financePages: { path: string; marker: string; label: string }[] = [
    { path: "/admin", marker: "Ringkasan admin", label: "ringkasan" },
    { path: "/admin/deposit", marker: "Antrean deposit", label: "deposit" },
    { path: "/admin/penarikan", marker: "Antrean penarikan", label: "penarikan" },
    { path: "/admin/komisi", marker: "Antrean komisi", label: "komisi" },
    { path: "/admin/imbalan", marker: "Persentase rabat", label: "imbalan" },
    { path: "/admin/audit", marker: "50 catatan terbaru", label: "jejak audit" },
    { path: "/admin/fraud", marker: "Antrean kasus", label: "anti-fraud" },
  ];

  for (const page of financePages) {
    const result = await finance.get(page.path);
    check(
      `keuangan membuka halaman ${page.label}`,
      result.status === 200 && bodyHas(result, page.marker),
      `HTTP ${result.status}`,
    );
  }

  const financeDeposit = await finance.get("/admin/deposit");
  check(
    "keuangan mendapat seluruh tindakan tinjauan deposit",
    bodyHas(financeDeposit, "Anda dapat menjalankan seluruh tindakan tinjauan"),
    "teks kewenangan penuh",
  );
  const financeRebate = await finance.get("/admin/imbalan");
  check(
    "keuangan dapat mengubah persentase rabat",
    bodyHas(financeRebate, "Persentase rabat generasi 1"),
    "kolom isian tersedia",
  );
  const financeFraud = await finance.get("/admin/fraud");
  check(
    "keuangan hanya membaca antrean anti-fraud (tidak menutup kasus)",
    bodyHas(financeFraud, "Anda hanya dapat membaca antrean ini"),
    "tanpa kewenangan menutup kasus",
  );

  const credit = await finance.post("/api/admin/credits", {
    userId: "00000000-0000-0000-0000-000000000000",
    amount: "1000",
    reason: "Uji panel admin",
    reference: `panel-uji-${Date.now()}`,
  });
  check(
    "keuangan ditolak saat memberi kredit saldo",
    credit.status === 403,
    `HTTP ${credit.status} ${errorCode(credit)}`,
  );

  const roleChange = await finance.post("/api/admin/users/role", {
    userId: "00000000-0000-0000-0000-000000000000",
    role: "SUPER_ADMIN",
  });
  check(
    "keuangan ditolak saat mengubah peran admin",
    roleChange.status === 403,
    `HTTP ${roleChange.status} ${errorCode(roleChange)}`,
  );

  const crossOrigin = await finance.post(
    "/api/admin/deposits",
    { depositId: "00000000-0000-0000-0000-000000000000", action: "APPROVED" },
    "http://penyerang.test",
  );
  check(
    "permintaan lintas situs ditolak",
    crossOrigin.status === 403 && errorCode(crossOrigin) === "FORBIDDEN",
    `HTTP ${crossOrigin.status} ${errorCode(crossOrigin)}`,
  );

  const financeDashboard = await finance.get("/admin");
  check(
    "panel tidak menawarkan kartu kredit saldo milik pemilik",
    !bodyHas(financeDashboard, "Kredit saldo administrator"),
    "kartu kredit tidak dirender",
  );

  console.log("\n== COMPLIANCE ==");
  const compliance = new Session(baseUrl);
  check(
    "kepatuhan dapat masuk",
    await compliance.login("panel-kepatuhan", ADMIN_PASSWORD),
    "panel-kepatuhan",
  );
  const complianceDeposit = await compliance.get("/admin/deposit");
  check(
    "kepatuhan hanya dapat meninjau atau menandai deposit",
    complianceDeposit.status === 200 &&
      bodyHas(complianceDeposit, "sedang ditinjau atau menandainya") &&
      !bodyHas(complianceDeposit, "Anda dapat menjalankan seluruh tindakan tinjauan"),
    `HTTP ${complianceDeposit.status}`,
  );
  const complianceWithdrawal = await compliance.get("/admin/penarikan");
  check(
    "kepatuhan hanya membaca antrean penarikan",
    complianceWithdrawal.status === 200 &&
      bodyHas(complianceWithdrawal, "Peran Anda hanya dapat membaca antrean ini"),
    `HTTP ${complianceWithdrawal.status}`,
  );
  const complianceFraud = await compliance.get("/admin/fraud");
  check(
    "kepatuhan dapat menutup kasus anti-fraud",
    complianceFraud.status === 200 &&
      bodyHas(complianceFraud, "Anda dapat menutup kasus dengan alasan tertulis"),
    `HTTP ${complianceFraud.status}`,
  );

  console.log("\n== SUPPORT ==");
  const support = new Session(baseUrl);
  check("dukungan dapat masuk", await support.login("panel-dukungan", ADMIN_PASSWORD), "panel-dukungan");
  const supportDashboard = await support.get("/admin");
  check(
    "dukungan membuka dasbor panel",
    supportDashboard.status === 200 && bodyHas(supportDashboard, "Ringkasan admin"),
    `HTTP ${supportDashboard.status}`,
  );
  check(
    "dukungan tidak ditawari jejak audit maupun anti-fraud",
    !bodyHas(supportDashboard, 'href="/admin/audit"') && !bodyHas(supportDashboard, 'href="/admin/fraud"'),
    "tautan tidak dirender",
  );
  const supportAudit = await support.get("/admin/audit");
  check(
    "halaman jejak audit menampilkan akses terbatas tanpa memuat baris",
    supportAudit.status === 200 &&
      bodyHas(supportAudit, "Akses terbatas") &&
      !bodyHas(supportAudit, "50 catatan audit terbaru dari database"),
    `HTTP ${supportAudit.status}`,
  );
  const supportFraud = await support.get("/admin/fraud");
  check(
    "halaman anti-fraud menampilkan akses terbatas tanpa memuat kasus",
    supportFraud.status === 200 &&
      bodyHas(supportFraud, "Akses terbatas") &&
      !bodyHas(supportFraud, "Status kasus"),
    `HTTP ${supportFraud.status}`,
  );
  const supportRebate = await support.get("/admin/imbalan");
  check(
    "dukungan membaca persentase rabat tanpa dapat mengubahnya",
    supportRebate.status === 200 && !bodyHas(supportRebate, "Persentase rabat generasi 1"),
    `HTTP ${supportRebate.status}`,
  );

  console.log("\n== VIEWER ==");
  const viewer = new Session(baseUrl);
  check("pengamat dapat masuk", await viewer.login("panel-pengamat", ADMIN_PASSWORD), "panel-pengamat");
  const viewerDeposit = await viewer.get("/admin/deposit");
  check(
    "pengamat hanya membaca antrean deposit",
    viewerDeposit.status === 200 &&
      bodyHas(viewerDeposit, "Peran Anda hanya dapat membaca antrean ini"),
    `HTTP ${viewerDeposit.status}`,
  );
  const viewerAudit = await viewer.get("/admin/audit");
  check(
    "pengamat tidak dapat membaca jejak audit",
    viewerAudit.status === 200 && bodyHas(viewerAudit, "Akses terbatas"),
    `HTTP ${viewerAudit.status}`,
  );

  /** Kapabilitas milik pemilik tidak boleh punya halaman di panel peran biasa. */
  const forbiddenPages = ["/admin/kredit", "/admin/peran", "/admin/pengguna"];
  const existingForbidden = forbiddenPages.filter((href) =>
    existsSync(path.join(process.cwd(), "src", "app", ...href.replace(/^\//, "").split("/"), "page.tsx")),
  );
  check(
    "panel tidak memiliki halaman kredit saldo atau pengelola peran",
    existingForbidden.length === 0,
    existingForbidden.length === 0 ? "tidak ada" : existingForbidden.join(", "),
  );

  check(
    "daftar halaman panel sama dengan berkas halaman yang ada",
    ADMIN_CONSOLE_PATHS.every((href) =>
      existsSync(path.join(process.cwd(), "src", "app", ...href.replace(/^\//, "").split("/"), "page.tsx")),
    ),
    `${ADMIN_CONSOLE_PATHS.length} halaman`,
  );

  check(
    "manifest panel menyebut nama aplikasi admin",
    manifestJson.name === ADMIN_MANIFEST.name,
    String(manifestJson.name),
  );

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} lulus`);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log("Gagal:");
    for (const result of failed) console.log(` - ${result.name} (${result.detail})`);
  }
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  console.error(error);
  process.exit(1);
});
