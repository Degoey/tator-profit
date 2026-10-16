import process from "node:process";

import { PrismaClient } from "@prisma/client";

import { assignAdminRole } from "../src/lib/services/admin-role-service";

/**
 * Menjadikan satu akun anggota sebagai petugas admin Panel Admin.
 *
 * Anggota yang mendaftar sendiri selalu berperan `USER`, sedangkan Panel Admin
 * hanya menerima akun `ADMIN` yang punya peran admin eksplisit. Skrip ini
 * menjembatani keduanya dalam satu perintah, dengan jejak audit untuk keduanya:
 *
 *   1. `User.role`: USER -> ADMIN  (aksi `admin.account_promoted`)
 *   2. `User.adminRole`: -> FINANCE/SUPPORT/... lewat `assignAdminRole`
 *      (aksi `admin.role_assigned`, jalur yang sama dengan konsol pemilik)
 *
 * Tidak ada uang yang bergerak di sini: kredit saldo tetap hanya lewat
 * `creditBalanceByAdmin` di konsol pemilik.
 *
 * Pemakaian (dari akar proyek, di mesin tempat database itu berada):
 *   npm run petugas:admin -- --username=siti --role=FINANCE --actor=barusta --confirm
 *   npm run petugas:admin -- --username=siti --role=none --actor=barusta --confirm
 *   npm run petugas:admin -- --username=siti --turunkan --actor=barusta --confirm
 *
 * `--role=none` mencabut peran admin (akun tetap boleh masuk panel, hanya bisa
 * membaca). `--turunkan` mengembalikan akun menjadi anggota biasa.
 */

const prisma = new PrismaClient();

const ROLES = ["SUPER_ADMIN", "FINANCE", "SUPPORT", "COMPLIANCE", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

function argValue(flag: string): string | null {
  const prefix = `${flag}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main(): Promise<void> {
  if (!hasFlag("--confirm")) {
    throw new Error("Tambahkan --confirm untuk menyetujui perubahan peran ini.");
  }

  const username = argValue("--username");
  const actorUsername = argValue("--actor");
  const rawRole = (argValue("--role") ?? "").toLowerCase();
  const demote = hasFlag("--turunkan");

  if (!username || !actorUsername) {
    throw new Error("Wajib: --username=<akun petugas> --actor=<akun SUPER_ADMIN> --confirm.");
  }
  if (!demote && !rawRole) {
    throw new Error("Wajib salah satu: --role=FINANCE|SUPPORT|COMPLIANCE|VIEWER|SUPER_ADMIN|none, atau --turunkan.");
  }

  const role: Role | null = demote
    ? null
    : rawRole === "none"
      ? null
      : (ROLES.find((candidate) => candidate.toLowerCase() === rawRole) ?? null);
  if (!demote && rawRole !== "none" && role === null) {
    throw new Error(`Peran "${rawRole}" tidak dikenal. Pilihan: ${ROLES.join(", ")}, none.`);
  }

  const actor = await prisma.user.findUnique({
    where: { username: actorUsername },
    select: { id: true, username: true, role: true, adminRole: true },
  });
  if (!actor || actor.role !== "ADMIN" || actor.adminRole !== "SUPER_ADMIN") {
    throw new Error(`Akun pelaksana "${actorUsername}" bukan ADMIN dengan peran SUPER_ADMIN.`);
  }

  const target = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, name: true, role: true, adminRole: true },
  });
  if (!target) throw new Error(`Akun "${username}" tidak ditemukan.`);

  if (demote) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { role: "USER", adminRole: null },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "admin.account_demoted",
          entityType: "User",
          entityId: target.id,
          before: { role: target.role, adminRole: target.adminRole },
          after: { role: "USER", adminRole: null, username: target.username },
        },
      });
    });
    console.log(`@${target.username} kembali menjadi anggota biasa (role USER, tanpa peran admin).`);
    return;
  }

  if (target.role !== "ADMIN") {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { role: "ADMIN" } });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "admin.account_promoted",
          entityType: "User",
          entityId: target.id,
          before: { role: target.role, adminRole: target.adminRole },
          after: { role: "ADMIN", adminRole: target.adminRole, username: target.username },
        },
      });
    });
    console.log(`@${target.username}: peran akun dinaikkan USER -> ADMIN (tercatat di jejak audit).`);
  }

  const result = await assignAdminRole({
    targetUserId: target.id,
    role,
    actorUserId: actor.id,
    actorAdminRole: actor.adminRole,
  });

  console.log(
    result.changed
      ? `@${target.username}: peran admin sekarang ${result.adminRole ?? "tanpa peran"} (tercatat di jejak audit).`
      : `@${target.username}: peran admin sudah ${result.adminRole ?? "tanpa peran"}, tidak ada perubahan.`,
  );
  console.log("Selesai. Petugas dapat masuk ke Panel Admin dengan akun dan sandinya sendiri.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
