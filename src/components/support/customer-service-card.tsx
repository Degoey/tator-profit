import { LifeBuoy, ShieldAlert } from "lucide-react";

import {
  WhatsAppCustomerServiceButton,
  type CustomerServiceFallback,
} from "@/components/support/whatsapp-cs-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPORT_TOPICS } from "@/lib/config/support";

export interface CustomerServiceCardProps {
  /** Pre-built `https://wa.me/...` link, or `null` when nothing is configured. */
  href: string | null;
  /** Surface the card lives on, forwarded to the button for manual QA. */
  location?: string;
  fallback?: CustomerServiceFallback;
  /** Help categories listed on the card. */
  topics?: readonly string[];
  className?: string;
}

/**
 * Help panel for the signed-in area. Customer service runs entirely on WhatsApp, so
 * the card only explains the categories and opens the chat: there is no ticket form,
 * no chat history and no internal message list.
 */
export function CustomerServiceCard({
  href,
  location = "profil",
  fallback = "hidden",
  topics = SUPPORT_TOPICS,
  className,
}: CustomerServiceCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="size-4 text-[var(--color-gold)]" aria-hidden />
          Bantuan &amp; Customer Service
        </CardTitle>
        <CardDescription>
          Layanan pelanggan Tatorprofit hanya melalui WhatsApp. Tidak ada tiket, live chat, atau
          riwayat percakapan di dalam aplikasi: percakapan berlangsung langsung di WhatsApp Anda dan
          hanya Anda yang menekan tombol kirim.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <ul className="grid gap-2 sm:grid-cols-2">
          {topics.map((topic) => (
            <li
              key={topic}
              className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-sm text-white/70"
            >
              <span
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-neon)]"
                aria-hidden
              />
              {topic}
            </li>
          ))}
        </ul>

        <WhatsAppCustomerServiceButton
          href={href}
          location={location}
          fallback={fallback}
          className="w-full sm:w-auto"
        />

        <p className="flex gap-2.5 text-xs leading-relaxed text-white/50">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-gold)]" aria-hidden />
          Pesan awal terisi otomatis dan hanya memuat kategori bantuan serta nama pengguna. Jangan
          pernah mengirim kata sandi, OTP, atau token kepada siapa pun, termasuk Customer Service.
        </p>
      </CardContent>
    </Card>
  );
}
