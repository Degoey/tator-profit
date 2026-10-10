/**
 * Reject cross-site state-changing requests. Returns false when Origin is absent.
 *
 * Next's development server can normalize `request.url` to localhost even when
 * the browser reached it through the machine's LAN address. The Host header is
 * the request authority in that case, so use it when constructing the effective
 * target origin (while retaining the URL scheme, or the trusted proxy scheme).
 */
export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host")?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const protocol = forwardedProtocol || requestUrl.protocol.replace(/:$/, "");
    const targetOrigin = host ? new URL(`${protocol}://${host}`).origin : requestUrl.origin;
    return new URL(origin).origin === targetOrigin;
  } catch {
    return false;
  }
}

/** Thrown by {@link requireSameOrigin}; routes must map it to a 403 response. */
export class CrossOriginError extends Error {
  constructor() {
    super("Permintaan lintas situs ditolak.");
    this.name = "CrossOriginError";
  }
}

/**
 * Throwing variant of {@link assertSameOrigin}. Prefer `assertSameOrigin` in
 * route handlers; this helper exists for call sites that already run inside a
 * `try/catch` that maps `CrossOriginError` to 403.
 */
export function requireSameOrigin(request: Request): void {
  if (!assertSameOrigin(request)) throw new CrossOriginError();
}
