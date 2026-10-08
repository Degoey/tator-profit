import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Lupa kata sandi",
  description: "Ajukan atur ulang kata sandi untuk akun Tatorprofit Anda.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Atur ulang kata sandi"
      description="Masukkan surel terdaftar. Kami membuat token atur ulang sekali pakai yang disimpan sebagai hash di database."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
