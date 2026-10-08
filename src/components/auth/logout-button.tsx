"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

export function LogoutButton({ variant = "outline", size = "sm" }: Pick<ButtonProps, "variant" | "size">) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant={variant} size={size} onClick={handleLogout} disabled={pending}>
      <LogOut aria-hidden />
      {pending ? "Keluar..." : "Keluar"}
    </Button>
  );
}
