import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Buat akun",
  description: "Buat akun Tatorprofit dan simpan profil serta data program Anda secara permanen.",
};

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      title="Buat akun Tatorprofit"
      description="Semua data akun disimpan di database. Kata sandi disimpan sebagai hash bcrypt, dan kode referral (jika ada) dicatat permanen."
    >
      <Suspense fallback={<p className="text-sm text-white/50">Memuat formulir...</p>}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
