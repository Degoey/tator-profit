import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk ke akun Tatorprofit Anda.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      title="Masuk ke Tatorprofit"
      description="Masuk menggunakan nama pengguna atau email yang terdaftar. Sesi disimpan di database dengan cookie httpOnly."
    >
      <Suspense fallback={<p className="text-sm text-white/50">Memuat formulir...</p>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
