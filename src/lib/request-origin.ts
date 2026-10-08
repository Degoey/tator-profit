/** Reject cross-site state-changing requests. Returns false when Origin is absent. */
export function assertSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
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
