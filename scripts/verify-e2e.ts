import { PrismaClient } from "@prisma/client";

import { verifyBalanceInvariant } from "../src/lib/services/ledger-service";

/**
 * End-to-end verification for Tatorprofit MVP parts 1 and 2.
 *
 * Requires the app to be running (`npm run dev` or `npm run start`) and the
 * database to be migrated + seeded. It registers real accounts (a referral chain
 * plus an admin), signs in, joins program tiers, drives the reward engine through
 * its admin API and verifies every row in PostgreSQL — then removes the temporary
 * accounts.
 *
 * Usage: npm run verify:e2e
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

const stamp = `${Date.now()}`.slice(-7);
const password = "Tator12345";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** React SSR inserts `<!-- -->` between adjacent text nodes; strip it before matching copy. */
function visibleText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/** Slice of the dashboard HTML that holds the network tree card. */
function treeRegion(html: string, length = 12000): string {
  const index = html.indexOf("Pohon jaringan rujukan");
  return index < 0 ? "" : html.slice(index, index + length);
}

/** Markup right after a node's username — i.e. that node's generation label. */
function labelAfter(html: string, needle: string, length = 120): string {
  const index = needle ? html.indexOf(needle) : -1;
  return index < 0 ? "" : html.slice(index, index + length);
}

function describeNode(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** First money value rendered after a stat label (icons are stripped first). */
function moneyAfterLabel(html: string, label: string, length = 900): string {
  const index = html.indexOf(label);
  if (index < 0) return "";
  const slice = html.slice(index, index + length).replace(/<svg[\s\S]*?<\/svg>/g, "");
  const match = slice.match(/[\d.]+,\d{2}\s*USDT/);
  return match ? match[0] : "";
}

/**
 * Client IPs per simulated actor. The auth routes rate limit per IP, so a single
 * machine creating 8 accounts must look like 8 clients — exactly like the real
 * traffic the limiter is designed for. The set is randomised per run so repeated
 * verification runs never inherit an exhausted bucket.
 */
function randomIpSet() {
  const host = 1 + Math.floor(Math.random() * 200);
  return {
    alice: `198.18.0.${host}`,
    bob: `198.18.1.${host}`,
    chain: (level: number) => `198.18.${level + 2}.${host}`,
  };
}

type IpSet = ReturnType<typeof randomIpSet>;

function cookieJar(ip?: string) {
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

async function request(
  path: string,
  options: { method?: string; body?: unknown; jar?: Jar; ip?: string } = {},
): Promise<{ status: number; body: Record<string, unknown>; text: string; location: string | null }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if ((options.method ?? "GET") !== "GET") headers.Origin = BASE_URL;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.jar) headers.Cookie = options.jar.header();
  const ip = options.ip ?? options.jar?.ip;
  if (ip) headers["x-forwarded-for"] = ip;

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
    parsed = { raw: text.slice(0, 200) };
  }
  if (response.status >= 400 && process.env.E2E_DEBUG) {
    console.log(`DEBUG ${path} ${JSON.stringify(parsed)}`);
  }
  return { status: response.status, body: parsed, text, location: response.headers.get("location") };
}

async function main() {
  const alice = {
    name: "Alice Verifier",
    username: `alice_${stamp}`,
    email: `alice_${stamp}@example.com`,
    phone: `+62811${stamp}`,
    password,
  };
  const bob = {
    name: "Bob Verifier",
    username: `bob_${stamp}`,
    email: `bob_${stamp}@example.com`,
    phone: `+62812${stamp}`,
    password,
  };

  let ipSet: IpSet = randomIpSet();
  let aliceJar = cookieJar(ipSet.alice);
  let registerAlice = await request("/api/auth/register", {
    method: "POST",
    jar: aliceJar,
    body: { ...alice, acceptTerms: true },
  });
  // A previous run in the same limiter window can leave the bucket warm.
  for (let attempt = 0; attempt < 4 && registerAlice.status === 429; attempt += 1) {
    ipSet = randomIpSet();
    aliceJar = cookieJar(ipSet.alice);
    registerAlice = await request("/api/auth/register", {
      method: "POST",
      jar: aliceJar,
      body: { ...alice, acceptTerms: true },
    });
  }
  check(
    "pendaftaran akun alice",
    registerAlice.status === 201,
    `status=${registerAlice.status} ip=${ipSet.alice}`,
  );

  const aliceData = (registerAlice.body.data ?? {}) as { referralCode?: string };
  const aliceCode = aliceData.referralCode ?? "";
  check("alice menerima kode rujukan", Boolean(aliceCode), aliceCode);
  check(
    "cookie sesi alice diterbitkan",
    aliceJar.header().includes("tatorprofit_session="),
    aliceJar.header() ? "cookie tersedia" : "tanpa cookie",
  );

  const bobJar = cookieJar(ipSet.bob);
  const registerBob = await request("/api/auth/register", {
    method: "POST",
    jar: bobJar,
    body: { ...bob, referralCode: aliceCode, acceptTerms: true },
  });
  check(
    "pendaftaran bob dengan kode rujukan",
    registerBob.status === 201,
    `status=${registerBob.status}`,
  );

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    ip: ipSet.alice,
    body: { ...alice, acceptTerms: true },
  });
  check("nama pengguna duplikat ditolak", duplicate.status === 409, `status=${duplicate.status}`);

  const badLogin = await request("/api/auth/login", {
    method: "POST",
    ip: ipSet.bob,
    body: { identifier: bob.username, password: "WrongPassword1" },
  });
  check("kata sandi salah ditolak", badLogin.status === 401, `status=${badLogin.status}`);

  const bobLoginJar = cookieJar(ipSet.bob);
  const login = await request("/api/auth/login", {
    method: "POST",
    jar: bobLoginJar,
    body: { identifier: bob.email, password, remember: true },
  });
  check("masuk dengan surel setelah pendaftaran", login.status === 200, `status=${login.status}`);

  const profile = await request("/api/profile", { jar: bobLoginJar });
  const profileUser = (profile.body.data ?? {}) as {
    user?: { username?: string; referredBy?: { username?: string } | null };
  };
  check(
    "sesi merujuk ke akun yang tersimpan",
    profile.status === 200 && profileUser.user?.username === bob.username,
    `status=${profile.status} username=${profileUser.user?.username ?? "n/a"}`,
  );
  check(
    "rujukan induk tercatat",
    profileUser.user?.referredBy?.username === alice.username,
    profileUser.user?.referredBy?.username ?? "none",
  );

  const programs = await request("/api/programs");
  const programData = (programs.body.data ?? {}) as {
    tiers?: { id: string }[];
    source?: string;
  };
  const tiers = programData.tiers ?? [];
  check(
    "paket program dimuat dari database",
    tiers.length === 9,
    `count=${tiers.length} source=${programData.source}`,
  );

  const join = await request("/api/programs/join", {
    method: "POST",
    jar: bobLoginJar,
    body: { tierId: tiers[0]?.id },
  });
  const joinData = (join.body.data ?? {}) as { status?: string; weeklyRewardTarget?: string };
  check(
    "gabung tercatat sebagai MENUNGGU",
    join.status === 201 && joinData.status === "PENDING",
    `status=${join.status} membership=${joinData.status}`,
  );
  check(
    "target mingguan untuk USDT 10 adalah 1.00 (hanya target)",
    joinData.weeklyRewardTarget === "1.00",
    `weekly=${joinData.weeklyRewardTarget}`,
  );

  const logout = await request("/api/auth/logout", { method: "POST", jar: bobLoginJar });
  check("keluar berhasil", logout.status === 200, `status=${logout.status}`);

  const afterLogout = await request("/api/profile", { jar: bobLoginJar });
  check("sesi dicabut setelah keluar", afterLogout.status === 401, `status=${afterLogout.status}`);

  const users = await prisma.user.findMany({
    where: { username: { in: [alice.username, bob.username] } },
    select: { id: true, username: true, passwordHash: true },
  });
  check("dua akun tersimpan di postgres", users.length === 2, `count=${users.length}`);
  check(
    "kata sandi disimpan sebagai hash bcrypt",
    users.every((user) => user.passwordHash.startsWith("$2")),
    users[0]?.passwordHash.slice(0, 7) ?? "n/a",
  );

  const bobRow = users.find((user) => user.username === bob.username);
  let bobActivePassword = bob.password;

  if (bobRow) {
    const [profileRow, balance, referral, memberships, rewards, events] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: bobRow.id }, select: { referralCode: true } }),
      prisma.balance.findUnique({ where: { userId: bobRow.id }, select: { availableAmount: true } }),
      prisma.referral.findUnique({
        where: { referredUserId: bobRow.id },
        select: { codeUsed: true, level: true },
      }),
      prisma.userProgram.count({ where: { userId: bobRow.id } }),
      prisma.reward.count({ where: { userId: bobRow.id } }),
      prisma.securityEvent.count({ where: { userId: bobRow.id } }),
    ]);

    check(
      "baris profil + saldo bob tersedia",
      Boolean(profileRow) && Boolean(balance),
      `available=${balance?.availableAmount.toFixed(2) ?? "n/a"}`,
    );
    check(
      "baris rujukan menghubungkan bob ke alice",
      referral?.codeUsed === aliceCode,
      referral?.codeUsed ?? "none",
    );
    check(
      "gabung tersimpan sebagai MENUNGGU tanpa kredit imbalan",
      memberships === 1 && rewards === 0 && balance?.availableAmount.toFixed(2) === "0.00",
      `memberships=${memberships} rewards=${rewards} available=${balance?.availableAmount.toFixed(2) ?? "n/a"}`,
    );
    check("peristiwa keamanan bob tercatat", events > 0, `events=${events}`);

    const forgot = await request("/api/auth/forgot-password", {
      method: "POST",
      ip: ipSet.bob,
      body: { email: bob.email },
    });
    const forgotData = (forgot.body.data ?? {}) as { requested?: boolean; devToken?: string };
    check(
      "permintaan lupa kata sandi diterima",
      forgot.status === 200 && forgotData.requested === true,
      `status=${forgot.status}`,
    );

    const resetRows = await prisma.passwordResetToken.findMany({
      where: { userId: bobRow.id },
      select: { tokenHash: true, usedAt: true, expiresAt: true },
    });
    check(
      "token atur ulang disimpan sebagai hash, tidak pernah mentah",
      resetRows.length > 0 &&
        resetRows.every((row) => row.tokenHash !== forgotData.devToken && row.tokenHash.length === 64),
      `rows=${resetRows.length} hashLength=${resetRows[0]?.tokenHash.length ?? 0}`,
    );
    check(
      "token atur ulang kedaluwarsa dalam 60 menit",
      resetRows.length > 0 &&
        resetRows.every((row) => row.expiresAt.getTime() - Date.now() <= 60 * 60 * 1000),
      resetRows[0] ? `${Math.round((resetRows[0].expiresAt.getTime() - Date.now()) / 60000)} min` : "n/a",
    );

    if (forgotData.devToken) {
      const newPassword = "Tator67890";
      bobActivePassword = newPassword;
      const reset = await request("/api/auth/reset-password", {
        method: "POST",
        ip: ipSet.bob,
        body: { token: forgotData.devToken, password: newPassword, confirmPassword: newPassword },
      });
      check("atur ulang kata sandi diterima", reset.status === 200, `status=${reset.status}`);

      const relogin = await request("/api/auth/login", {
        method: "POST",
        ip: ipSet.bob,
        body: { identifier: bob.username, password: newPassword },
      });
      check("masuk dengan kata sandi baru", relogin.status === 200, `status=${relogin.status}`);

      const reuse = await request("/api/auth/reset-password", {
        method: "POST",
        ip: ipSet.bob,
        body: { token: forgotData.devToken, password: "Tator11111", confirmPassword: "Tator11111" },
      });
      check("token atur ulang hanya sekali pakai", reuse.status >= 400, `status=${reuse.status}`);

      const usedRows = await prisma.passwordResetToken.count({
        where: { userId: bobRow.id, usedAt: { not: null } },
      });
      check("token terpakai ditandai sudah digunakan", usedRows === 1, `used=${usedRows}`);
    } else {
      console.log(
        "CATATAN  devToken disembunyikan di luar mode pengembangan — jalankan terhadap `next dev` untuk uji penuh atur ulang",
      );
    }
  }

  // Builds a real 5-generation chain under alice: alice → gen1 → … → gen5.
  const chainUsernames: string[] = [];
  const chainJars: Jar[] = [];
  let sponsorCode = aliceCode;
  for (let level = 1; level <= 5; level += 1) {
    const member = {
      name: `Chain Gen ${level}`,
      username: `gen${level}_${stamp}`,
      email: `gen${level}_${stamp}@example.com`,
      phone: `+6291${level}${stamp}`,
      password,
    };
    const jar = cookieJar(ipSet.chain(level));
    const response = await request("/api/auth/register", {
      method: "POST",
      jar,
      body: { ...member, acceptTerms: true, referralCode: sponsorCode },
    });
    const issued = ((response.body.data ?? {}) as { referralCode?: string }).referralCode ?? "";
    check(
      `generasi rantai ${level} terdaftar di bawah sponsornya`,
      response.status === 201 && Boolean(issued),
      `status=${response.status}`,
    );
    chainUsernames.push(member.username);
    chainJars.push(jar);
    sponsorCode = issued;
  }

  const aliceDashboard = await request("/dashboard", { jar: aliceJar });
  const aliceHtml = visibleText(aliceDashboard.text);
  const aliceTree = treeRegion(aliceHtml);
  const deepestUnderAlice = labelAfter(aliceTree, `@${chainUsernames.at(4) ?? ""}`);
  check(
    "dasbor alice menampilkan pohon jaringan",
    aliceDashboard.status === 200 &&
      aliceTree.includes("Pohon jaringan rujukan") &&
      aliceTree.includes("Kamu (pusat)") &&
      aliceTree.includes(`@${bob.username}`),
    `status=${aliceDashboard.status} pusat=${aliceTree.includes("Kamu (pusat)")} bob=${aliceTree.includes(`@${bob.username}`)}`,
  );
  check(
    "pohon menampilkan lima generasi dengan tarif yang dikonfigurasi",
    ["Generasi 1", "Generasi 2", "Generasi 3", "Generasi 4", "Generasi 5"].every((gen) =>
      aliceTree.includes(gen),
    ) &&
      ["10%", "2%", "1%"].every((rate) => aliceTree.includes(rate)) &&
      chainUsernames.every((username) => aliceTree.includes(`@${username}`)) &&
      aliceTree.includes("6 anggota ditampilkan") &&
      deepestUnderAlice.includes("Generasi 5") &&
      !deepestUnderAlice.includes("Generasi 4"),
    `members=${aliceTree.includes("6 anggota ditampilkan")} deepest=${describeNode(deepestUnderAlice)}`,
  );
  check(
    "jumlah anggota per generasi (2 langsung + 1 per generasi lebih dalam)",
    aliceTree.includes("2 anggota") && aliceTree.includes("1 anggota"),
    "gen1=2, gen2..5=1",
  );

  const carolJar = chainJars.at(0);
  const carolDashboard = await request("/dashboard", carolJar ? { jar: carolJar } : {});
  const carolHtml = visibleText(carolDashboard.text);
  const carolTree = treeRegion(carolHtml);
  const deepestUnderCarol = labelAfter(carolTree, `@${chainUsernames.at(4) ?? ""}`);
  const carolConditions = {
    status: carolDashboard.status === 200,
    gen2: carolTree.includes(`@${chainUsernames.at(1) ?? ""}`),
    gen5: carolTree.includes(`@${chainUsernames.at(4) ?? ""}`),
    total: carolTree.includes("4 anggota ditampilkan"),
    deepestGen4:
      deepestUnderCarol.includes("Generasi 4") && !deepestUnderCarol.includes("Generasi 5"),
    selfIsRoot: labelAfter(carolTree, `@${chainUsernames.at(0) ?? ""}`).includes("Kamu (pusat)"),
    selfAppearsOnce: carolTree.split(`@${chainUsernames.at(0) ?? ""}`).length - 1 === 1,
    noUnrelatedBob: !carolTree.includes(`@${bob.username}`),
  };
  const carolFailed = Object.entries(carolConditions)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  check(
    "generasi dihitung relatif terhadap pengguna (root gen1 melihat 4 generasi)",
    carolFailed.length === 0,
    carolFailed.length ? `failed=${carolFailed.join(",")}` : `deepest=${describeNode(deepestUnderCarol)}`,
  );
  const leakedContacts = [bob.email, bob.phone, ...chainUsernames.flatMap((username) => [
    `${username}@example.com`,
  ])];
  check(
    "html dasbor tidak membocorkan data kontak pengguna rujukan",
    leakedContacts.every((value) => !aliceDashboard.text.includes(value)),
    "hanya memuat nama pengguna",
  );

  const bobFreshJar = cookieJar(ipSet.bob);
  const bobRelogin = await request("/api/auth/login", {
    method: "POST",
    jar: bobFreshJar,
    body: { identifier: bob.username, password: bobActivePassword },
  });
  const bobDashboard = await request("/dashboard", { jar: bobFreshJar });
  const bobHtml = visibleText(bobDashboard.text);
  check(
    "bob hanya melihat pohonnya sendiri (jaringan alice tidak terlihat)",
    bobRelogin.status === 200 &&
      bobDashboard.status === 200 &&
      bobHtml.includes("Kamu (pusat)") &&
      bobHtml.includes("0 anggota ditampilkan") &&
      bobHtml.includes("Belum ada rujukan"),
    `status=${bobDashboard.status} empty=${bobHtml.includes("Belum ada rujukan")}`,
  );

  const guest = await request("/dashboard");
  check(
    "pengunjung dialihkan dari dasbor",
    guest.status === 307 && (guest.location ?? "").includes("/login"),
    `status=${guest.status} location=${guest.location ?? "n/a"}`,
  );

  // ------------------------------------------------------- program engine (part 2)
  const programsPage = await request("/programs");
  const programsHtml = visibleText(programsPage.text);
  check(
    "halaman program menampilkan 9 nominal x 3 durasi (27 kombinasi) dengan tarif target terkonfigurasi",
    programsPage.status === 200 &&
      programsHtml.includes("Target Imbalan: 10% per minggu") &&
      programsHtml.includes(
        "Target imbalan mengikuti ketentuan program, kualifikasi, dan aturan yang berlaku.",
      ) &&
      programsHtml.includes("Nilai gabung") &&
      programsHtml.includes("Target imbalan mingguan") &&
      programsHtml.includes("Target imbalan per siklus") &&
      programsHtml.includes("4 minggu") &&
      programsHtml.includes("8 minggu") &&
      programsHtml.includes("12 minggu") &&
      programsHtml.includes("27 kombinasi program") &&
      programsHtml.includes("Pilih durasi") &&
      programsHtml.includes("USDT"),
    `status=${programsPage.status}`,
  );
  check(
    "kartu paket menampilkan perhitungan desimal backend (100 -> 10 mingguan / 40 siklus, 10000 -> 1000 / 4000)",
    ["100,00 USDT", "40,00 USDT", "10.000,00 USDT", "4.000,00 USDT", "1.000,00 USDT"].every(
      (value) => programsHtml.includes(value),
    ) && !programsHtml.toLowerCase().includes("dijamin"),
    "tidak ada klaim keuntungan yang dijamin",
  );

  const adminIp = `198.18.9.${1 + Math.floor(Math.random() * 200)}`;
  const admin = {
    name: "Admin Verifier",
    username: `admin_${stamp}`,
    email: `admin_${stamp}@example.com`,
    phone: `+62813${stamp}`,
    password,
  };
  const adminRegister = await request("/api/auth/register", {
    method: "POST",
    jar: cookieJar(adminIp),
    body: { ...admin, acceptTerms: true },
  });
  check("pendaftaran calon admin", adminRegister.status === 201, `status=${adminRegister.status}`);

  const adminRow = await prisma.user.findUnique({
    where: { username: admin.username },
    select: { id: true },
  });
  if (adminRow) {
    // RBAC fail-closed: a plain ADMIN has no financial capability, so the finance
    // actor used by this script must hold the SUPER_ADMIN administrator role.
    await prisma.user.update({
      where: { id: adminRow.id },
      data: { role: "ADMIN", adminRole: "SUPER_ADMIN" },
    });
  }
  const adminJar = cookieJar(adminIp);
  const adminLogin = await request("/api/auth/login", {
    method: "POST",
    jar: adminJar,
    body: { identifier: admin.username, password },
  });
  check(
    "akun admin dipromosikan dan masuk",
    Boolean(adminRow) && adminLogin.status === 200,
    `status=${adminLogin.status}`,
  );

  const bobMembership = bobRow
    ? await prisma.userProgram.findFirst({
        where: { userId: bobRow.id },
        orderBy: { joinedAt: "asc" },
        select: { id: true, status: true },
      })
    : null;

  const forbiddenActivation = await request("/api/admin/programs", {
    method: "POST",
    jar: bobFreshJar,
    body: { action: "activate", userProgramId: bobMembership?.id },
  });
  check(
    "non-admin tidak dapat mengaktifkan keanggotaan",
    forbiddenActivation.status === 403,
    `status=${forbiddenActivation.status}`,
  );

  const activation = await request("/api/admin/programs", {
    method: "POST",
    jar: adminJar,
    body: { action: "activate", userProgramId: bobMembership?.id, confirmedAmount: "10.00" },
  });
  const activationData = (activation.body.data ?? {}) as {
    status?: string;
    fundsConfirmedAmount?: string;
    rewardsCreated?: number;
  };
  check(
    "admin mengonfirmasi dana masuk dan mengaktifkan keanggotaan",
    activation.status === 200 &&
      activationData.status === "ACTIVE" &&
      activationData.fundsConfirmedAmount === "10.00",
    `status=${activation.status} membership=${activationData.status}`,
  );
  check(
    "aktivasi mencatat imbalan minggu 1 sebagai MENUNGGU",
    activationData.rewardsCreated === 1,
    `created=${activationData.rewardsCreated}`,
  );

  const firstGeneration = await request("/api/admin/rewards", {
    method: "POST",
    jar: adminJar,
    body: { action: "generate", userProgramId: bobMembership?.id },
  });
  const secondGeneration = await request("/api/admin/rewards", {
    method: "POST",
    jar: adminJar,
    body: { action: "generate", userProgramId: bobMembership?.id },
  });
  const firstData = (firstGeneration.body.data ?? {}) as { created?: unknown[]; skipped?: unknown[] };
  const secondData = (secondGeneration.body.data ?? {}) as {
    created?: unknown[];
    skipped?: unknown[];
  };
  check(
    "mesin imbalan idempoten untuk periode yang sama",
    firstGeneration.status === 200 &&
      secondGeneration.status === 200 &&
      firstData.created?.length === 0 &&
      secondData.created?.length === 0 &&
      secondData.skipped?.length === 1,
    `first=${firstData.created?.length ?? "n/a"} second=${secondData.created?.length ?? "n/a"} skipped=${secondData.skipped?.length ?? "n/a"}`,
  );

  const engineRows = bobRow
    ? await Promise.all([
        prisma.userProgram.findFirst({
          where: { userId: bobRow.id },
          orderBy: { joinedAt: "asc" },
          select: {
            status: true,
            fundsConfirmedAmount: true,
            weeklyRewardRate: true,
            cycleWeeks: true,
            activatedAt: true,
          },
        }),
        prisma.balance.findUnique({
          where: { userId: bobRow.id },
          select: {
            availableAmount: true,
            pendingAmount: true,
            programFundsAmount: true,
            totalEarned: true,
          },
        }),
        prisma.reward.findMany({
          where: { userId: bobRow.id },
          select: { id: true, amount: true, rate: true, period: true, status: true, transactionId: true },
        }),
        prisma.transaction.findMany({
          where: { userId: bobRow.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, type: true, status: true, bucket: true, amount: true },
        }),
      ])
    : null;

  const membershipRow = engineRows?.[0] ?? null;
  const balanceRow = engineRows?.[1] ?? null;
  const rewardRows = engineRows?.[2] ?? [];
  const ledgerRows = engineRows?.[3] ?? [];
  const weekOne = rewardRows.find((row) => row.period === 1) ?? null;

  check(
    "keanggotaan AKTIF dengan dana program tercatat terpisah dari saldo imbalan",
    membershipRow?.status === "ACTIVE" &&
      membershipRow.fundsConfirmedAmount.toFixed(2) === "10.00" &&
      balanceRow?.programFundsAmount.toFixed(2) === "10.00" &&
      balanceRow.availableAmount.toFixed(2) === "0.00",
    `status=${membershipRow?.status ?? "n/a"} funds=${balanceRow?.programFundsAmount.toFixed(2) ?? "n/a"} available=${balanceRow?.availableAmount.toFixed(2) ?? "n/a"}`,
  );
  check(
    "imbalan minggu 1 adalah 1.00 (10 x 10%) dengan snapshot tarif tersimpan pada baris",
    weekOne?.amount.toFixed(2) === "1.00" &&
      weekOne.rate.toFixed(4) === "0.1000" &&
      weekOne.status === "PENDING",
    `amount=${weekOne?.amount.toFixed(2) ?? "n/a"} rate=${weekOne?.rate.toFixed(4) ?? "n/a"}`,
  );
  check(
    "buku besar memuat komitmen gabung dan entri dana terkonfirmasi",
    ledgerRows.some(
      (row) =>
        row.type === "PROGRAM_JOIN" &&
        row.bucket === "PROGRAM_FUNDS" &&
        row.amount.toFixed(2) === "10.00",
    ) && ledgerRows.some((row) => row.type === "PROGRAM_JOIN" && row.bucket === "NONE"),
    ledgerRows.map((row) => `${row.type}/${row.bucket}`).join(" "),
  );

  const approve = await request("/api/admin/rewards", {
    method: "POST",
    jar: adminJar,
    body: { action: "approve", rewardId: weekOne?.id },
  });
  const approveData = (approve.body.data ?? {}) as { status?: string; amount?: string };
  check(
    "admin menyetujui imbalan (MENUNGGU -> DISETUJUI)",
    approve.status === 200 && approveData.status === "APPROVED" && approveData.amount === "1.00",
    `status=${approve.status} reward=${approveData.status}`,
  );

  const afterApprove = bobRow
    ? await prisma.balance.findUnique({
        where: { userId: bobRow.id },
        select: { pendingAmount: true, availableAmount: true },
      })
    : null;
  check(
    "persetujuan menyimpan dana sebagai menunggu, belum dapat dibelanjakan",
    afterApprove?.pendingAmount.toFixed(2) === "1.00" &&
      afterApprove.availableAmount.toFixed(2) === "0.00",
    `pending=${afterApprove?.pendingAmount.toFixed(2) ?? "n/a"}`,
  );

  const pay = await request("/api/admin/rewards", {
    method: "POST",
    jar: adminJar,
    body: { action: "pay", rewardId: weekOne?.id },
  });
  const payData = (pay.body.data ?? {}) as { status?: string; transactionId?: string | null };
  check(
    "admin membayar imbalan (DISETUJUI -> DIBAYAR)",
    pay.status === 200 && payData.status === "PAID" && Boolean(payData.transactionId),
    `status=${pay.status} reward=${payData.status}`,
  );

  const afterPay = bobRow
    ? await prisma.balance.findUnique({
        where: { userId: bobRow.id },
        select: { pendingAmount: true, availableAmount: true, totalEarned: true },
      })
    : null;
  check(
    "pembayaran memindahkan tepat 1.00 ke saldo yang dapat dibelanjakan",
    afterPay?.availableAmount.toFixed(2) === "1.00" &&
      afterPay.pendingAmount.toFixed(2) === "0.00" &&
      afterPay.totalEarned.toFixed(2) === "1.00",
    `available=${afterPay?.availableAmount.toFixed(2) ?? "n/a"}`,
  );

  const doublePay = await request("/api/admin/rewards", {
    method: "POST",
    jar: adminJar,
    body: { action: "pay", rewardId: weekOne?.id },
  });
  const afterDoublePay = bobRow
    ? await prisma.balance.findUnique({
        where: { userId: bobRow.id },
        select: { availableAmount: true },
      })
    : null;
  check(
    "pembayaran kedua untuk imbalan yang sama ditolak (tanpa kredit ganda)",
    doublePay.status === 409 && afterDoublePay?.availableAmount.toFixed(2) === "1.00",
    `status=${doublePay.status} available=${afterDoublePay?.availableAmount.toFixed(2) ?? "n/a"}`,
  );

  // Multiple programs: a second tier accrues its own independent periods.
  const secondJoin = await request("/api/programs/join", {
    method: "POST",
    jar: bobFreshJar,
    body: { tierId: tiers[3]?.id },
  });
  check(
    "keanggotaan kedua pada paket lain diterima",
    secondJoin.status === 201,
    `status=${secondJoin.status}`,
  );

  const secondMembership = bobRow
    ? await prisma.userProgram.findFirst({
        where: { userId: bobRow.id, tierId: tiers[3]?.id },
        select: { id: true },
      })
    : null;
  const secondActivation = await request("/api/admin/programs", {
    method: "POST",
    jar: adminJar,
    body: { action: "activate", userProgramId: secondMembership?.id },
  });
  const secondActivationData = (secondActivation.body.data ?? {}) as { rewardsCreated?: number };
  const allRewards = bobRow
    ? await prisma.reward.findMany({
        where: { userId: bobRow.id },
        select: { userProgramId: true, period: true, amount: true, status: true },
      })
    : [];
  check(
    "beberapa program menambah periode imbalan independen (paket USDT 10 dan USDT 100)",
    secondActivation.status === 200 &&
      secondActivationData.rewardsCreated === 1 &&
      allRewards.length === 2 &&
      allRewards.some((row) => row.amount.toFixed(2) === "1.00") &&
      allRewards.some((row) => row.amount.toFixed(2) === "10.00"),
    `rewards=${allRewards.length}`,
  );

  const bobDashboardAgain = await request("/dashboard", { jar: bobFreshJar });
  const bobDashboardHtml = visibleText(bobDashboardAgain.text);
  const dashboardFigures = {
    totalBalance: moneyAfterLabel(bobDashboardHtml, "Total saldo"),
    currentReward: moneyAfterLabel(bobDashboardHtml, "Imbalan saat ini"),
    nextReward: moneyAfterLabel(bobDashboardHtml, "Imbalan berikutnya"),
    programFunds: moneyAfterLabel(bobDashboardHtml, "Dana program"),
    available: moneyAfterLabel(bobDashboardHtml, "Saldo tersedia"),
  };
  const dashboardTokens = [
    "Total saldo",
    "Program aktif",
    "2 keanggotaan tercatat",
    "Imbalan saat ini",
    "Imbalan berikutnya",
    "Progres program",
    "Minggu 1",
    "Minggu 4",
    "Riwayat transaksi",
    "Gabung program",
  ];
  const missingDashboardTokens = dashboardTokens.filter(
    (token) => !bobDashboardHtml.includes(token),
  );
  check(
    "dasbor menampilkan angka langsung dari database (saldo, program, imbalan, buku besar)",
    bobDashboardAgain.status === 200 &&
      missingDashboardTokens.length === 0 &&
      dashboardFigures.totalBalance === "1,00 USDT" &&
      dashboardFigures.available === "1,00 USDT" &&
      dashboardFigures.currentReward === "10,00 USDT" &&
      dashboardFigures.nextReward === "10,00 USDT" &&
      dashboardFigures.programFunds === "110,00 USDT",
    `status=${bobDashboardAgain.status} missing=${missingDashboardTokens.join("|") || "none"} figures=${JSON.stringify(dashboardFigures)}`,
  );
  check(
    "dasbor menampilkan dana program tercatat terpisah dari saldo imbalan",
    bobDashboardHtml.includes("Dana program") &&
      moneyAfterLabel(bobDashboardHtml, "Dana program") === "110,00 USDT" &&
      moneyAfterLabel(bobDashboardHtml, "Menunggu persetujuan") === "0,00 USDT",
    `funds=${moneyAfterLabel(bobDashboardHtml, "Dana program")} pending=${moneyAfterLabel(bobDashboardHtml, "Menunggu persetujuan")}`,
  );

  const postedLedgerRow = bobRow
    ? await prisma.transaction.findFirst({ where: { userId: bobRow.id }, select: { id: true } })
    : null;
  let ledgerDeleteBlocked = false;
  let ledgerUpdateBlocked = false;
  if (postedLedgerRow) {
    try {
      await prisma.transaction.delete({ where: { id: postedLedgerRow.id } });
    } catch {
      ledgerDeleteBlocked = true;
    }
    try {
      await prisma.transaction.update({ where: { id: postedLedgerRow.id }, data: { amount: 999 } });
    } catch {
      ledgerUpdateBlocked = true;
    }
  }
  check(
    "buku besar hanya dapat ditambah di level database (hapus dan ubah nominal diblokir)",
    ledgerDeleteBlocked && ledgerUpdateBlocked,
    `delete=${ledgerDeleteBlocked} update=${ledgerUpdateBlocked}`,
  );

  const invariant = bobRow ? await verifyBalanceInvariant(prisma, bobRow.id) : null;
  check(
    "saldo per keranjang sesuai dengan entri buku besar yang tercatat",
    invariant?.ok === true,
    invariant?.checks.map((row) => `${row.bucket}:${row.ledger}/${row.balance}`).join(" ") ?? "n/a",
  );




  /**
   * Proves both login limiters engage. Each is an in-process 5 minute window, so
   * every probe uses fresh random values to stay repeatable:
   *  - per-IP window: 12 failures are answered, the 13th from the same address is blocked;
   *    the identifier is rotated so only the address bucket can fill up.
   *  - per-account window: 10 failures are answered, the 11th for the same identifier is
   *    blocked even when the client address changes (the header cannot be spoofed into
   *    bypassing this limit).
   */
  function randomProbeIp(): string {
    return `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  }

  let perIpStatuses: number[] = [];
  for (let round = 0; round < 4 && perIpStatuses.at(0) !== 401; round += 1) {
    const ip = randomProbeIp();
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 13; attempt += 1) {
      const response = await request("/api/auth/login", {
        method: "POST",
        ip,
        body: { identifier: `nobody_ip_${stamp}_${round}_${attempt}`, password: "WrongPassword1" },
      });
      statuses.push(response.status);
    }
    perIpStatuses = statuses;
  }
  check(
    "pembatasan laju per-IP memblokir percobaan masuk yang gagal berulang",
    perIpStatuses.at(0) === 401 &&
      perIpStatuses.slice(0, 12).every((status) => status === 401) &&
      perIpStatuses.at(12) === 429,
    perIpStatuses.join(","),
  );

  const accountIdentifier = `nobody_acct_${stamp}`;
  const perAccountStatuses: number[] = [];
  for (let attempt = 1; attempt <= 11; attempt += 1) {
    const response = await request("/api/auth/login", {
      method: "POST",
      ip: randomProbeIp(),
      body: { identifier: accountIdentifier, password: "WrongPassword1" },
    });
    perAccountStatuses.push(response.status);
  }
  check(
    "pembatasan laju per-akun memblokir percobaan masuk walau alamat klien berubah",
    perAccountStatuses.slice(0, 10).every((status) => status === 401) &&
      perAccountStatuses.at(10) === 429,
    perAccountStatuses.join(","),
  );

  const chainRows = await prisma.user.findMany({
    where: { username: { in: chainUsernames } },
    select: { id: true },
  });
  check("lima akun rantai tersimpan di postgres", chainRows.length === 5, `count=${chainRows.length}`);

  if (process.env.E2E_DUMP) {
    const index = aliceDashboard.text.indexOf("Pohon jaringan rujukan");
    console.log(aliceDashboard.text.slice(Math.max(0, index - 300), index + 5000));
  }

  const cleanupIds = [
    ...users.map((user) => user.id),
    ...chainRows.map((row) => row.id),
    ...(adminRow ? [adminRow.id] : []),
  ];
  if (process.env.E2E_KEEP === "1") {
    console.log("CATATAN  E2E_KEEP=1 — akun verifikasi dibiarkan di database untuk pemeriksaan");
  } else if (cleanupIds.length > 0) {
    // Ledger rows are protected by the append-only trigger; teardown unlocks the
    // purge explicitly for this transaction only.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
      await tx.referral.deleteMany({
        where: { OR: [{ referrerId: { in: cleanupIds } }, { referredUserId: { in: cleanupIds } }] },
      });
      await tx.user.deleteMany({ where: { id: { in: cleanupIds } } });
    });
    const remaining = await prisma.user.count({ where: { id: { in: cleanupIds } } });
    check("akun verifikasi sementara dihapus", remaining === 0, `remaining=${remaining}`);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pemeriksaan lulus`);
  if (failed.length > 0) {
    console.error(`Gagal: ${failed.map((result) => result.name).join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Verifikasi E2E gagal dijalankan", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
