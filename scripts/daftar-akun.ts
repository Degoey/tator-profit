import process from "node:process";

import { PrismaClient } from "@prisma/client";

/**
 * Daftar akun (hanya baca) untuk memilih petugas admin.
 *
 * Menampilkan nama pengguna, nama, peran, peran admin, status, dan tanggal daftar —
 * plus kontak yang **disamarkan** (mis. `d***@gmail.com`, `0812****34`), karena
 * keluaran skrip ini kerap disalin ke percakapan. Tidak ada satu pun perintah tulis
 * di sini: skrip hanya membaca, jadi menjalankannya di database produksi pun aman.
 *
 * Pemakaian:
 *   npm run akun:daftar                    # database aplikasi (DATABASE_URL)
 *   npm run akun:daftar -- --admin         # hanya akun dengan peran ADMIN
 *   npm run akun:daftar -- --cari=barusta  # saring nama pengguna/nama
 */

const prisma = new PrismaClient();

function argValue(flag: string): string | null {
  const prefix = `${flag}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.charAt(0)}***${email.slice(at)}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  return `${phone.slice(0, 4)}****${phone.slice(-2)}`;
}

async function main(): Promise<void> {
  const search = argValue("--cari")?.toLowerCase() ?? null;
  const adminOnly = hasFlag("--admin");

  const users = await prisma.user.findMany({
    where: {
      ...(adminOnly ? { role: "ADMIN" } : {}),
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      username: true,
      name: true,
      role: true,
      adminRole: true,
      status: true,
      createdAt: true,
      email: true,
      phone: true,
    },
  });

  if (users.length === 0) {
    console.log("Tidak ada akun yang cocok.");
    return;
  }

  console.log(
    `${users.length} akun${adminOnly ? " (hanya peran ADMIN)" : ""}${
      search ? ` · saringan "${search}"` : ""
    }\n`,
  );

  const width = Math.max(...users.map((user) => user.username.length), 8);
  for (const [index, user] of users.entries()) {
    const registered = user.createdAt.toISOString().slice(0, 10);
    console.log(
      `${String(index + 1).padStart(2)}. ${user.username.padEnd(width)}  ${user.name}  ` +
        `[${user.role}${user.adminRole ? ` · ${user.adminRole}` : ""} · ${user.status}]  ` +
        `daftar ${registered}  ${maskEmail(user.email)}  ${maskPhone(user.phone)}`,
    );
  }

  const admins = users.filter((user) => user.role === "ADMIN").length;
  console.log(`\nTotal ${users.length} akun · ${admins} berperan ADMIN.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
