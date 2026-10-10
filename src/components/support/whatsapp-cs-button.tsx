import { WhatsAppIcon } from "@/components/support/whatsapp-icon";
import { Button } from "@/components/ui/button";
import { WHATSAPP_CS_NUMBER_ENV } from "@/lib/config/support";
import { cn } from "@/lib/utils";

/** What to render when no valid customer service number is configured. */
export type CustomerServiceFallback = "notice" | "hidden";

export interface WhatsAppCustomerServiceButtonProps {
  /** Pre-built `https://wa.me/...` link, or `null` when nothing is configured. */
  href: string | null;
  /** Surface the button lives on (`beranda`, `dasbor`, `profil`), kept for manual QA. */
  location: string;
  label?: string;
  variant?: "default" | "gold" | "outline" | "ghost" | "link";
  size?: "sm" | "default" | "lg";
  /** `notice` explains the missing configuration, `hidden` renders nothing (production). */
  fallback?: CustomerServiceFallback;
  className?: string;
}

/**
 * Reusable customer service button. It is a plain link to the official `wa.me`
 * click-to-chat endpoint, so the user always presses send inside WhatsApp: nothing is
 * ever sent automatically and no WhatsApp credential is requested or stored.
 *
 * Without a valid number the component refuses to render a link: development shows a
 * configuration hint, production renders nothing.
 */
export function WhatsAppCustomerServiceButton({
  href,
  location,
  label = "Hubungi Customer Service",
  variant = "gold",
  size = "default",
  fallback = "hidden",
  className,
}: WhatsAppCustomerServiceButtonProps) {
  if (!href) {
    if (fallback !== "notice") return null;
    return (
      <p
        role="status"
        className={cn(
          "rounded-xl border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 p-3.5 text-xs leading-relaxed text-[var(--color-gold)]",
          className,
        )}
      >
        Tombol Customer Service WhatsApp belum aktif karena variabel lingkungan{" "}
        <span className="font-mono">{WHATSAPP_CS_NUMBER_ENV}</span> belum diisi dengan nomor yang
        valid (format <span className="font-mono">62xxxxxxxxxx</span>, hanya angka).
      </p>
    );
  }

  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} Tatorprofit melalui WhatsApp (membuka tab baru)`}
        data-customer-service={location}
      >
        <WhatsAppIcon aria-hidden />
        {label}
      </a>
    </Button>
  );
}
