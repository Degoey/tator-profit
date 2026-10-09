import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Atur Ulang Kata Sandi",
  description:
    "Selesaikan atur ulang kata sandi akun Tatorprofit Anda memakai token sekali pakai yang berlaku 60 menit.",
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      title="Atur ulang kata sandi"
      description="Masukkan token atur ulang beserta kata sandi baru Anda. Setelah berhasil, seluruh sesi lama akun ini dicabut."
      footer={
        <p>
          Ingat kata sandi Anda?{" "}
          <span className="text-white/70">Masuk kembali dari halaman masuk.</span>
        </p>
      }
    >
      <Suspense fallback={<p className="text-sm text-white/50">Memuat formulir...</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
