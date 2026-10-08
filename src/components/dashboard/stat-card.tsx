import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "gold" | "muted";
}

const toneStyles: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-[var(--color-neon)]",
  gold: "text-[var(--color-gold)]",
  muted: "text-white/70",
};

export function StatCard({ label, value, hint, icon: Icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
        <Icon className={cn("size-4", toneStyles[tone])} aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-white/45">{hint}</p> : null}
    </Card>
  );
}
