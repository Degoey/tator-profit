import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";
import { assertNotProduction } from "../src/lib/config/maintenance-guard";

/**
 * Route and authorization verification (Bagian 7/7).
 *
 * Drives the real HTTP surface for every route the platform promises:
 *  - public pages must render for guests (200),
 *  - protected pages must redirect guests to `/login` with a `next` parameter,
 *  - the same pages must render for a signed-in member (200),
 *  - `/admin` must stay closed for a normal member and open for a SUPER_ADMIN,
 *  - admin APIs must answer 403 for a member session and 200 for a SUPER_ADMIN,
 *  - rendered money must never contain a bare `USD` code or a `$` sign,
 *  - `/deposit` must serve the BEP-20 wallet QR and address, including for a
 *    member who has no pending membership yet (empty-state card).
 *
 * Usage: `npm run dev` (in another terminal) then `npm run verify:routes`.
 * Every account it creates is removed again at the end.
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

/** Public pages that must render for a guest. */
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/programs",
  "/terms",
  "/privacy",
  "/risk-disclosure",
  "/referral-terms",
  "/withdrawal-policy",
];

/** Signed-in pages that must redirect guests and render for a member. */
const PROTECTED_ROUTES = [
  "/dashboard",
  "/deposit",
  "/rewards",
  "/transactions",
  "/referral",
  "/withdrawal",
  "/profile",
  "/security",
  "/notifications",
];

/** One browser-like session: keeps the httpOnly session cookie between calls. */
class Session {
  private cookie = "";

  constructor(readonly label: string) {}

  async request(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{
    status: number;
    location: string | null;
    contentType: string | null;
    text: string;
    body: any;
  }> {
    const headers: Record<string, string> = { origin: BASE_URL, accept: "text/html,application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    if (init.body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
    });

    for (const entry of response.headers.getSetCookie()) {
      const [pair = ""] = entry.split(";");
      if (pair.startsWith("tatorprofit_session=")) this.cookie = pair;
    }

    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    return {
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      text,
      body,
    };
  }

  async register(username: string, name: string) {
    return this.request("/api/auth/register", {
      body: {
        name,
        username,
        email: `${username}@example.com`,
        phone: `+6282${stamp}${Math.floor(Math.random() * 90 + 10)}`,
        bankAccountNumber: `0123${stamp}7890`,
        bank: "BCA",
        password,
        acceptTerms: true,
      },
    });
  }
}

async function main() {
  assertNotProduction(process.env, "Verifikasi route");

  const member = new Session("member");
  const memberUsername = `route_member_${stamp}`;
  const memberRegistration = await member.register(memberUsername, "Route Member");
  check(
    "akun anggota uji dapat dibuat lewat HTTP",
    memberRegistration.status === 201,
    `status=${memberRegistration.status}`,
  );
  if (memberRegistration.body?.data?.userId) {
    createdUserIds.push(memberRegistration.body.data.userId);
  }

  const admin = new Session("admin");
  const adminUsername = `route_admin_${stamp}`;
  const adminRegistration = await admin.register(adminUsername, "Route Admin");
  check(
    "akun administrator uji dapat dibuat lewat HTTP",
    adminRegistration.status === 201,
    `status=${adminRegistration.status}`,
  );

  if (adminRegistration.body?.data?.userId) {
    const adminId = adminRegistration.body.data.userId as string;
    createdUserIds.push(adminId);
    await prisma.user.update({
      where: { id: adminId },
      data: {
        role: "ADMIN",
        adminRole: "SUPER_ADMIN",
        passwordHash: await hashPassword(password),
      },
    });
  }

  // 1. Public pages render for a guest.
  const guestFailures: string[] = [];
  for (const route of PUBLIC_ROUTES) {
    const guest = new Session("guest");
    const response = await guest.request(route);
    if (response.status !== 200) guestFailures.push(`${route}=${response.status}`);
  }
  check(
    "seluruh halaman publik merender 200 untuk pengunjung",
    guestFailures.length === 0,
    guestFailures.length === 0 ? `${PUBLIC_ROUTES.length} halaman` : guestFailures.join(" "),
  );

  // 2. Protected pages redirect guests to /login with a next parameter.
  const guestRedirectFailures: string[] = [];
  for (const route of PROTECTED_ROUTES) {
    const guest = new Session("guest");
    const response = await guest.request(route);
    const expected = `/login?next=${encodeURIComponent(route)}`;
    const ok = response.status === 307 && (response.location ?? "").includes(expected);
    if (!ok) guestRedirectFailures.push(`${route}=${response.status}:${response.location ?? "-"}`);
  }
  check(
    "seluruh halaman terlindungi mengalihkan pengunjung ke /login dengan parameter next",
    guestRedirectFailures.length === 0,
    guestRedirectFailures.length === 0
      ? `${PROTECTED_ROUTES.length} halaman`
      : guestRedirectFailures.join(" "),
  );

  // 3. The same pages render for the signed-in member.
  const memberFailures: string[] = [];
  for (const route of PROTECTED_ROUTES) {
    const response = await member.request(route);
    if (response.status !== 200) memberFailures.push(`${route}=${response.status}`);
  }
  check(
    "seluruh halaman terlindungi merender 200 untuk anggota yang masuk",
    memberFailures.length === 0,
    memberFailures.length === 0 ? `${PROTECTED_ROUTES.length} halaman` : memberFailures.join(" "),
  );

  // 4. /admin stays closed for a normal member.
  const memberAdmin = await member.request("/admin");
  check(
    "anggota biasa tidak dapat membuka /admin",
    memberAdmin.status === 307 && (memberAdmin.location ?? "").includes("error=forbidden"),
    `status=${memberAdmin.status} lokasi=${memberAdmin.location ?? "-"}`,
  );

  // 5. /admin renders for a SUPER_ADMIN, including the role management surface.
  const adminPage = await admin.request("/admin");
  check(
    "SUPER_ADMIN dapat membuka /admin dan melihat kartu peran administrator",
    adminPage.status === 200 && adminPage.text.includes("Peran administrator"),
    `status=${adminPage.status}`,
  );

  // 6. The admin role API is protected on the server, not in the UI.
  const memberRoleApi = await member.request("/api/admin/users/role");
  const adminRoleApi = await admin.request("/api/admin/users/role");
  check(
    "API peran administrator menolak anggota biasa dan melayani SUPER_ADMIN",
    memberRoleApi.status === 403 && adminRoleApi.status === 200 && adminRoleApi.body?.ok === true,
    `anggota=${memberRoleApi.status} super=${adminRoleApi.status}`,
  );

  // 6b. Referral commission settlement is protected on the server too: the queue
  // is readable for any administrator (`read`), while changing it needs
  // `manageFinance`, exactly like the deposit and withdrawal reviews.
  const memberCommissionQueue = await member.request("/api/admin/commissions");
  const adminCommissionQueue = await admin.request("/api/admin/commissions");
  const memberCommissionAction = await member.request("/api/admin/commissions", {
    body: { commissionId: "00000000-0000-4000-8000-000000000000", action: "PAY" },
  });
  check(
    "antrean komisi admin hanya untuk administrator dan aksinya butuh manageFinance",
    memberCommissionQueue.status === 403 &&
      adminCommissionQueue.status === 200 &&
      Array.isArray(adminCommissionQueue.body?.data?.rows) &&
      memberCommissionAction.status === 403,
    `anggota-baca=${memberCommissionQueue.status} super-baca=${adminCommissionQueue.status} anggota-aksi=${memberCommissionAction.status}`,
  );
  check(
    "kartu komisi rujukan dirender pada /admin untuk administrator",
    adminPage.status === 200 && adminPage.text.includes("Komisi rujukan"),
    `status=${adminPage.status}`,
  );

  // 7. Money is always rendered as USDT, never as a bare USD code or a `$` amount.
  // Next.js serialises data into inline <script> tags (where `$1` style references
  // appear), so only the visible markup is inspected.
  const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
  const bareUsd = (html: string) => /USD(?!T)/.test(html);
  const dollarAmount = (html: string) => /\$\s?\d/.test(html);

  const moneySurfaces: { name: string; html: string }[] = [
    { name: "admin", html: visible(adminPage.text) },
    { name: "imbalan", html: visible((await member.request("/rewards")).text) },
    { name: "transaksi", html: visible((await member.request("/transactions")).text) },
    { name: "dasbor", html: visible((await member.request("/dashboard")).text) },
  ];
  const moneyFailures = moneySurfaces.filter(
    (surface) => bareUsd(surface.html) || dollarAmount(surface.html),
  );
  check(
    "permukaan uang hanya menampilkan USDT (tanpa kode USD telanjang atau tanda $)",
    moneyFailures.length === 0,
    moneyFailures.length === 0
      ? moneySurfaces.map((surface) => surface.name).join(", ")
      : moneyFailures
          .map(
            (surface) =>
              `${surface.name}(USD=${bareUsd(surface.html)} $=${dollarAmount(surface.html)})`,
          )
          .join(" "),
  );

  // 8. The security page states honestly that 2FA is not available.
  const securityPage = await member.request("/security");
  check(
    "halaman keamanan menyatakan 2FA belum tersedia tanpa status keamanan palsu",
    securityPage.status === 200 && securityPage.text.includes("Belum tersedia"),
    `status=${securityPage.status}`,
  );

  // 9. The deposit page always serves the payment QR: the freshly registered
  // member has no PENDING membership, so this exercises the empty-state card
  // where the address used to be hidden completely.
  const depositPage = await member.request("/deposit");
  const qrAsset = await member.request("/barcode-indodax.png");
  check(
    "halaman deposit menampilkan QR dompet BEP-20 beserta alamatnya",
    depositPage.status === 200 &&
      depositPage.text.includes("barcode-indodax-container") &&
      depositPage.text.includes("0xd442e9B62244B8347E1C95ED7098C71AD05a36C7") &&
      depositPage.text.includes("BEP-20") &&
      qrAsset.status === 200 &&
      (qrAsset.contentType ?? "").includes("image/png"),
    `halaman=${depositPage.status} aset=${qrAsset.status} ${qrAsset.contentType ?? "-"}`,
  );

  // 10. The withdrawal form offers the same BEP-20 crypto method as the deposit
  // page: the payout lands on the deposit wallet's network, so a TRC20 label
  // here would send a member's USDT to the wrong chain.
  const withdrawalPage = await member.request("/withdrawal");
  check(
    "halaman penarikan menawarkan metode kripto BEP-20 tanpa label TRC20",
    withdrawalPage.status === 200 &&
      withdrawalPage.text.includes("Kripto (USDT BEP-20)") &&
      /TRC-?20|TRON/i.test(withdrawalPage.text) === false,
    `status=${withdrawalPage.status}`,
  );

  // 11. The deposit QR is public: a visitor who has not created an account yet
  // must be able to scan the wallet straight from the landing page, with the
  // same address and the same BEP-20 label as `/deposit`.
  const landingPage = await new Session("guest").request("/");
  check(
    "halaman depan menampilkan QR dompet BEP-20 untuk pengunjung",
    landingPage.status === 200 &&
      landingPage.text.includes("barcode-indodax-container") &&
      landingPage.text.includes("0xd442e9B62244B8347E1C95ED7098C71AD05a36C7") &&
      landingPage.text.includes("BEP-20"),
    `halaman=${landingPage.status}`,
  );

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pemeriksaan lulus.`);
  if (failed.length > 0) {
    console.error(`Gagal: ${failed.map((row) => row.name).join("; ")}`);
    process.exitCode = 1;
  }
}

/** Removes every row this script created; audit rows keep a nullable actor. */
async function cleanup() {
  if (createdUserIds.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
    await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  console.log(`Pembersihan: ${createdUserIds.length} akun uji beserta datanya dihapus.`);
}

main()
  .catch((error) => {
    console.error("Verifikasi route gagal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Pembersihan gagal:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });

