/**
 * Customer service Tatorprofit is WhatsApp-only.
 *
 * There is deliberately no ticket system, no internal conversation history and no
 * message endpoint: this module is the single source of truth that turns the
 * configured customer service number into a validated `wa.me` link. Every surface
 * (landing page, dashboard, profile) renders the same reusable button from this data.
 */

/** Public environment variable that holds the customer service number. */
export const WHATSAPP_CS_NUMBER_ENV = "NEXT_PUBLIC_WHATSAPP_CS_NUMBER";

/**
 * `wa.me` accepts international digits only: the country code comes first, the value
 * is 8-15 digits long and never starts with a zero (Indonesian numbers therefore
 * start with `62`, never `08`).
 */
export const WHATSAPP_NUMBER_PATTERN = /^[1-9]\d{7,14}$/;

/** Topic used when a surface does not name one explicitly. */
export const DEFAULT_SUPPORT_TOPIC = "Bantuan umum";

/** Short help topics listed by the customer service card. */
export const SUPPORT_TOPICS = [
  "Bantuan umum",
  "Setoran dana",
  "Penarikan dana",
  "Paket program & keanggotaan",
  "Imbalan & target",
  "Rujukan & komisi",
  "Akun & keamanan",
] as const;

/**
 * Normalises a raw configured value into `wa.me` digits.
 *
 * `+62 812-3456-7890`, `6281234567890` and the local `081234567890` all resolve to
 * `6281234567890`. Anything that is not a plausible international number returns
 * `null`, so the UI can never build a broken or empty link.
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  // Indonesian local numbers (08xx) are rewritten to the international 62xx form.
  const international = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  // `62 08xx…` is a local number with the country code prepended by mistake: the
  // national part of an Indonesian number never starts with a zero.
  if (international.startsWith("620")) return null;
  return WHATSAPP_NUMBER_PATTERN.test(international) ? international : null;
}

/** `true` only when the raw value resolves to a number `wa.me` can open. */
export function isValidWhatsAppNumber(raw: string | null | undefined): boolean {
  return normalizeWhatsAppNumber(raw) !== null;
}

export interface CustomerServiceMessageOptions {
  /** Help category shown to the agent, for example `Setoran dana`. */
  topic?: string | null;
  /** Account username, only added on signed-in surfaces. */
  username?: string | null;
}

/**
 * Prefilled message for the WhatsApp chat.
 *
 * It carries the application name, the help category and (for signed-in surfaces)
 * the username only. No password, OTP, token or other secret is ever part of it.
 */
export function buildCustomerServiceMessage(
  options: CustomerServiceMessageOptions = {},
): string {
  const topic = (options.topic ?? "").trim() || DEFAULT_SUPPORT_TOPIC;
  const username = (options.username ?? "").trim();

  const lines = [
    "Halo Customer Service Tatorprofit, saya membutuhkan bantuan.",
    "Aplikasi: Tatorprofit",
    `Kategori bantuan: ${topic}`,
  ];
  if (username) lines.push(`Nama pengguna: ${username}`);
  lines.push("Terima kasih.");
  return lines.join("\n");
}

/**
 * Official click-to-chat link (`https://wa.me/<number>?text=<url-encoded message>`),
 * or `null` when the number is missing or invalid.
 */
export function buildWhatsAppLink(
  number: string | null | undefined,
  message: string,
): string | null {
  const normalized = normalizeWhatsAppNumber(number);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export interface CustomerServiceConfig {
  /** `true` only when a valid number produced a usable link. */
  configured: boolean;
  /** Normalised international digits, or `null`. */
  number: string | null;
  /** Ready to use `wa.me` link, or `null` when nothing is configured. */
  link: string | null;
  /** Message that was URL-encoded into `link`. */
  message: string;
  /** What the UI must do without a valid number: hint in development, hide in production. */
  fallback: "notice" | "hidden";
}

export interface CustomerServiceOptions extends CustomerServiceMessageOptions {
  /** Overrides the environment value (used by tests). `null` means "not configured". */
  rawNumber?: string | null;
  /** Overrides `NODE_ENV` (used by tests). */
  nodeEnv?: string;
}

/**
 * Resolves the customer service configuration for one surface.
 *
 * When the number is not configured the button is never pointed at a fake or empty
 * target: development renders an explicit configuration hint, production renders
 * nothing at all.
 */
export function getCustomerServiceConfig(
  options: CustomerServiceOptions = {},
): CustomerServiceConfig {
  const rawNumber =
    options.rawNumber === undefined
      ? process.env.NEXT_PUBLIC_WHATSAPP_CS_NUMBER
      : options.rawNumber;
  const nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv;

  const message = buildCustomerServiceMessage({
    topic: options.topic,
    username: options.username,
  });
  const number = normalizeWhatsAppNumber(rawNumber);
  const link = number ? buildWhatsAppLink(number, message) : null;

  return {
    configured: link !== null,
    number,
    link,
    message,
    fallback: nodeEnv === "production" ? "hidden" : "notice",
  };
}
