import { PrismaClient, type AdminRole } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";

/**
 * Prepares a local demo dataset for the Tatorprofit program engine.
 *
 * Run the app first (`npm run dev`), then: `npm run demo:local`
 *
 * It registers two accounts through the real HTTP API (so profiles, referral
 * codes, balances, notifications and audit logs are created exactly like a real
 * signup), promotes one of them to ADMIN *with an explicit admin role* (`role`
 * alone is not enough: the platform fails closed and refuses `/admin` without an
 * `adminRole`), has the member join the USDT 100 tier and lets the admin confirm
 * the funds. The result is a dashboard with real numbers instead of an empty
 * state.
 *
 * The script is idempotent: re-running it resets the demo passwords, reuses the
 * existing membership and never creates a duplicate reward period.
 */
const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const DEMO_PASSWORD = "Demo12345";

const prisma = new PrismaClient();

interface DemoAccount {
  name: string;
  username: string;
  email: string;
  phone: string;
  ip: string;
  role: "USER" | "ADMIN";
  /** Explicit administrator capability. Members carry none; fail-closed by design. */
  adminRole: AdminRole | null;
}

const MEMBER_ACCOUNT: DemoAccount = {
  name: "Demo Member",
  username: "demo_member",
  email: "demo_member@tatorprofit.local",
  phone: "+628110000001",
  ip: "203.0.113.10",
  role: "USER",
  adminRole: null,
};

const ADMIN_ACCOUNT: DemoAccount = {
  name: "Demo Admin",
  username: "demo_admin",
  email: "demo_admin@tatorprofit.local",
  phone: "+628110000002",
  ip: "203.0.113.11",
  role: "ADMIN",
  // Without an explicit admin role the admin guard refuses `/admin` and every
  // `/api/admin/*` route, so the demo admin would be locked out of its own demo.
  adminRole: "SUPER_ADMIN",
};

/** Target tier for the demo membership (USDT 100 -> 10,00 USDT target reward weekly). */
const DEMO_TIER_CODE = "USDT-100";

function cookieJar(ip: string) {
  const store = new Map<string, string>();
  return {
    ip,
    header(): string {
      return [...store.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    absorb(response: Response) {
      for (const raw of response.headers.getSetCookie()) {
        const [pair = ""] = raw.split(";");
        const separator = pair.indexOf("=");
        if (separator < 0) continue;
        store.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
      }
    },
  };
}

type Jar = ReturnType<typeof cookieJar>;

/**
 * Every mutating route enforces `assertSameOrigin`, which rejects a request
 * without an `Origin` header. A browser always sends one, but `fetch` from Node
 * does not, so the script would get a 403 on register/login/join/activate. The
 * header is therefore set explicitly to the origin the script talks to.
 */
async function request(
  path: string,
  options: { method?: string; body?: unknown; jar?: Jar } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: "application/json", Origin: BASE_URL };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.jar) {
    headers.Cookie = options.jar.header();
    headers["x-forwarded-for"] = options.jar.ip;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });

  options.jar?.absorb(response);
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed };
}


async function ensureAccount(account: DemoAccount): Promise<Jar> {
  const existing = await prisma.user.findUnique({
    where: { username: account.username },
    select: { id: true, role: true },
  });

  if (!existing) {
    const registered = await request("/api/auth/register", {
      method: "POST",
      jar: cookieJar(account.ip),
      body: {
        name: account.name,
        username: account.username,
        email: account.email,
        phone: account.phone,
        bankAccountNumber: "1234567890",
        bank: "BCA",
        password: DEMO_PASSWORD,
        acceptTerms: true,
      },
    });
    if (registered.status !== 201) {
      throw new Error(
        `pendaftaran ${account.username} gagal (${registered.status}) ${JSON.stringify(registered.body)}`,
      );
    }
    console.log(`+ terdaftar ${account.username}`);
  } else {
    // Keep the printed credentials valid across repeated runs.
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(DEMO_PASSWORD), status: "ACTIVE" },
    });
    console.log(`= memakai ulang ${account.username}`);
  }

  const row = await prisma.user.findUniqueOrThrow({
    where: { username: account.username },
    select: { id: true, role: true, adminRole: true },
  });

  // `role` alone is not enough: an ADMIN without an explicit `adminRole` is
  // refused by the admin guard, so both fields are kept in sync here.
  if (row.role !== account.role || row.adminRole !== account.adminRole) {
    await prisma.user.update({
      where: { id: row.id },
      data: { role: account.role, adminRole: account.adminRole },
    });
    console.log(
      `  peran ${account.username} -> ${account.role}${account.adminRole ? ` (${account.adminRole})` : ""}`,
    );
  }

  const jar = cookieJar(account.ip);
  const login = await request("/api/auth/login", {
    method: "POST",
    jar,
    body: { identifier: account.username, password: DEMO_PASSWORD },
  });
  if (login.status !== 200) {
    throw new Error(`masuk ${account.username} gagal (${login.status})`);
  }

  return jar;
}

async function main() {
  const health = await fetch(`${BASE_URL}/programs`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`Tidak dapat menjangkau ${BASE_URL}. Jalankan aplikasi dengan: npm run dev`);
  }

  const [member, admin] = await Promise.all([
    ensureAccount(MEMBER_ACCOUNT),
    ensureAccount(ADMIN_ACCOUNT),
  ]);

  const tier = await prisma.programTier.findFirst({
    where: { code: DEMO_TIER_CODE, isActive: true },
    select: { id: true, code: true, joinAmount: true, programId: true },
  });
  if (!tier) throw new Error(`Paket ${DEMO_TIER_CODE} tidak ditemukan. Jalankan: npm run db:seed`);

  // The demo membership uses the shortest duration (4 weeks, 40% target cycle).
  const cycle = await prisma.programCycle.findFirst({
    where: { programId: tier.programId, cycleWeeks: 4, isActive: true },
    select: { id: true, cycleWeeks: true, targetCycleRewardRate: true },
  });

  const memberRow = await prisma.user.findUniqueOrThrow({
    where: { username: MEMBER_ACCOUNT.username },
    select: { id: true },
  });

  let membership = await prisma.userProgram.findFirst({
    where: { userId: memberRow.id, tierId: tier.id },
    select: { id: true, status: true },
  });

  if (!membership) {
    const joined = await request("/api/programs/join", {
      method: "POST",
      jar: member,
      body: { tierId: tier.id, cycleId: cycle?.id },
    });
    if (joined.status !== 201) {
      throw new Error(`gabung gagal (${joined.status}) ${JSON.stringify(joined.body)}`);
    }
    console.log(
      `+ demo_member gabung ${tier.code} · ${cycle?.cycleWeeks ?? 4} minggu (target ${cycle ? cycle.targetCycleRewardRate.times(100).toFixed(0) : 40}% per siklus)`,
    );
    membership = await prisma.userProgram.findFirst({
      where: { userId: memberRow.id, tierId: tier.id },
      select: { id: true, status: true },
    });
  }

  if (membership && membership.status === "PENDING") {
    const activated = await request("/api/admin/programs", {
      method: "POST",
      jar: admin,
      body: { action: "activate", userProgramId: membership.id },
    });
    if (activated.status !== 200) {
      throw new Error(`aktivasi gagal (${activated.status}) ${JSON.stringify(activated.body)}`);
    }
    console.log(`+ demo_admin mengonfirmasi dana untuk ${tier.code}`);
  } else if (membership) {
    console.log(`= keanggotaan sudah ${membership.status}`);
  }

  const finalMembership = await prisma.userProgram.findFirstOrThrow({
    where: { userId: memberRow.id, tierId: tier.id },
    select: { status: true },
  });
  const rewards = await prisma.reward.findMany({
    where: { userId: memberRow.id },
    orderBy: { cycleNumber: "asc" },
    select: { status: true, cycleNumber: true, period: true, amount: true, currency: true },
  });
  const balances = await prisma.balance.findUnique({
    where: { userId: memberRow.id },
    select: { availableAmount: true, pendingAmount: true, programFundsAmount: true, currency: true },
  });

  const money = (value: { toString(): string } | null | undefined) =>
    value === null || value === undefined ? "n/a" : `${value.toString()} USDT`;

  console.log("\nDemo lokal siap");
  console.log(`  aplikasi   : ${BASE_URL}`);
  console.log(`  anggota    : demo_member / ${DEMO_PASSWORD}`);
  console.log(`  admin      : demo_admin  / ${DEMO_PASSWORD}`);
  console.log(
    `  keanggotaan: ${tier.code} (${tier.joinAmount.toFixed(2)} USDT) -> ${finalMembership.status}`,
  );
  console.log(`  imbalan    : ${rewards.length}`);
  for (const reward of rewards) {
    console.log(
      `    - siklus ${reward.cycleNumber} ${reward.period} ${reward.status} ${money(reward.amount)} ${reward.currency}`,
    );
  }
  console.log(`  tersedia   : ${money(balances?.availableAmount)}`);
  console.log(`  menunggu   : ${money(balances?.pendingAmount)}`);
  console.log(`  dana prog. : ${money(balances?.programFundsAmount)}`);

  const dashboard = await fetch(`${BASE_URL}/dashboard`, {
    headers: { Cookie: member.header(), "x-forwarded-for": member.ip },
    redirect: "manual",
  });
  const dashboardHtml = (await dashboard.text()).replace(/<!--[\s\S]*?-->/g, "");
  const stripTags = (markup: string) =>
    markup
      .replace(/<svg[\s\S]*?<\/svg>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  const dashboardText = stripTags(dashboardHtml);
  const rendered = {
    totalBalance: /Total saldo\s*[\d.]+,\d{2}\s*USDT/.exec(dashboardText)?.[0] ?? "missing",
    programFunds: /Dana program\s*[\d.]+,\d{2}\s*USDT/.exec(dashboardText)?.[0] ?? "missing",
    currentReward: /Imbalan saat ini\s*[\d.]+,\d{2}\s*USDT/.exec(dashboardText)?.[0] ?? "tidak ada",
    week1: dashboardText.includes("Minggu 1") ? "present" : "missing",
    ledger: dashboardText.includes("Riwayat transaksi") ? "present" : "missing",
  };
  console.log(`  dashboard  : ${dashboard.status}`);
  for (const [key, value] of Object.entries(rendered)) {
    console.log(`    - ${key}: ${value}`);
  }

  console.log(`\nBuka ${BASE_URL}/login lalu /dashboard atau /programs.`);
  console.log("Hapus nanti dengan: npm run demo:reset");
}

main()
  .catch((error) => {
    console.error("\nPenyiapan demo gagal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
